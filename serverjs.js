/* =========================================================
   CATÁLOGO API — Node.js + Express + PostgreSQL
   Tasa BCV automática + Panel admin con token de sesión.
   ========================================================= */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const multer   = require('multer');
const sharp    = require('sharp');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ---------------------------------------------------------
   CONFIGURACIÓN
   --------------------------------------------------------- */
const ADMIN_USER   = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS || 'cambiar_esto';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/* ---------------------------------------------------------
   CORS
   --------------------------------------------------------- */
const allowedOrigins = String(process.env.FRONTEND_URL || '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ---------------------------------------------------------
   PostgreSQL
   --------------------------------------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
});
pool.on('error', (err) => console.error('[PG] Error pool:', err.message));

/* ---------------------------------------------------------
   Uploads
   --------------------------------------------------------- */
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  setHeaders(res) { res.setHeader('Access-Control-Allow-Origin', '*'); },
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten archivos de imagen'));
    }
    cb(null, true);
  },
});

/* ---------------------------------------------------------
   HELPERS
   --------------------------------------------------------- */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function toNumber(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'si', 'sí', 'yes', 'on'].includes(String(v).toLowerCase());
}

/* ---------------------------------------------------------
   TOKEN DE SESIÓN (HMAC firmado)
   --------------------------------------------------------- */
function crearToken(user) {
  const payload = { user, exp: Date.now() + TOKEN_TTL_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verificarToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'No autorizado' });
  const payload = verificarToken(token);
  if (!payload) return res.status(401).json({ error: 'Token inválido o expirado' });
  req.admin = payload;
  next();
}

/* ---------------------------------------------------------
   RATE LIMITING en login
   --------------------------------------------------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
});

/* ---------------------------------------------------------
   CONFIGURACIÓN GENERAL
   --------------------------------------------------------- */
async function leerConfig() {
  const { rows } = await pool.query(`SELECT clave, valor FROM configuracion`);
  const map = {};
  rows.forEach((r) => { map[r.clave] = r.valor; });
  return {
    nombre_negocio: map.nombre_negocio || 'Mi Negocio',
    hero_titulo: map.hero_titulo || 'Todo lo que necesitas, en un solo lugar',
    hero_texto:
      map.hero_texto ||
      'Explora nuestro catálogo con productos seleccionados, precios actualizados y envíos a todo el país.',
    logo_url: map.logo_url || '',
    whatsapp_number: map.whatsapp_number || '',
    tasa_bcv: parseFloat(map.tasa_bcv || '0') || 0,
  };
}

async function guardarConfig(clave, valor) {
  await pool.query(
    `INSERT INTO configuracion (clave, valor, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (clave)
     DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
    [clave, String(valor ?? '')]
  );
}

/* ---------------------------------------------------------
   TASA BCV — 3 fuentes con fallback
   --------------------------------------------------------- */
async function fetchTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function tasaDesdeDolarApi() {
  const res = await fetchTimeout('https://ve.dolarapi.com/v1/dolares/oficial', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`dolarapi HTTP ${res.status}`);
  const json = await res.json();
  const n = Number(json.promedio ?? json.precio ?? json.price);
  if (!Number.isFinite(n) || n <= 0) throw new Error('dolarapi: valor inválido');
  return n;
}

async function tasaDesdePydolarve() {
  const res = await fetchTimeout('https://pydolarve.org/api/v1/dollar?page=bcv', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`pydolarve HTTP ${res.status}`);
  const json = await res.json();
  const n = Number(json?.monitors?.bcv?.price ?? json?.price);
  if (!Number.isFinite(n) || n <= 0) throw new Error('pydolarve: valor inválido');
  return n;
}

async function tasaDesdeBCVDirecto() {
  const res = await fetchTimeout('https://www.bcv.org.ve/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`BCV HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/id=["']dolar["'][\s\S]*?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i);
  if (!match) throw new Error('BCV: no se encontró el patrón de la tasa');
  const n = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new Error('BCV: valor inválido');
  return n;
}

async function leerTasaGuardada() {
  const { rows } = await pool.query(`SELECT valor FROM configuracion WHERE clave = 'tasa_bcv'`);
  return rows.length ? parseFloat(rows[0].valor) : 0;
}

async function actualizarTasaBCV() {
  const fuentes = [
    ['dolarapi.com', tasaDesdeDolarApi],
    ['pydolarve.org', tasaDesdePydolarve],
    ['bcv.org.ve (directo)', tasaDesdeBCVDirecto],
  ];
  for (const [nombre, fn] of fuentes) {
    try {
      const tasa = await fn();
      await guardarConfig('tasa_bcv', tasa);
      console.log(`[BCV] Tasa ${tasa} obtenida desde ${nombre}`);
      return tasa;
    } catch (err) {
      console.error(`[BCV] Falló ${nombre}: ${err.message}`);
    }
  }
  console.error('[BCV] Todas las fuentes fallaron.');
  return null;
}

actualizarTasaBCV();
setInterval(actualizarTasaBCV, 6 * 60 * 60 * 1000);

/* ---------------------------------------------------------
   HEALTH / CONFIG PÚBLICA / TASA
   --------------------------------------------------------- */
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'catalogo-api', time: new Date().toISOString() });
});

app.get('/api/health', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT NOW() AS now');
  res.json({ ok: true, db: rows[0].now });
}));

app.get('/api/config', asyncHandler(async (req, res) => {
  const cfg = await leerConfig();
  res.json(cfg);
}));

app.get('/api/tasa-bcv', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT valor, updated_at FROM configuracion WHERE clave = 'tasa_bcv'`
  );
  const tasa = rows.length ? parseFloat(rows[0].valor) : 0;
  res.json({ tasa_bcv: tasa, updated_at: rows[0]?.updated_at || null });
}));

/* =========================================================
   PÚBLICO
   ========================================================= */
app.get('/api/categorias', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, created_at FROM categorias ORDER BY nombre ASC`
  );
  res.json(rows);
}));

app.get('/api/productos', asyncHandler(async (req, res) => {
  const { categoria_id, q, destacado, disponible } = req.query;
  const conditions = [];
  const params = [];

  if (categoria_id) {
    params.push(categoria_id);
    conditions.push(`p.categoria_id = $${params.length}`);
  }
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    conditions.push(`(p.nombre ILIKE $${params.length} OR p.descripcion ILIKE $${params.length})`);
  }
  if (destacado === 'true') conditions.push('p.destacado = TRUE');
  if (disponible === 'true') conditions.push('p.disponible = TRUE');
  if (disponible === 'false') conditions.push('p.disponible = FALSE');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.descripcion, p.precio_usd, p.imagen_url,
            p.categoria_id, p.disponible, p.destacado, p.created_at,
            c.nombre AS categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       ${where}
      ORDER BY p.destacado DESC, p.created_at DESC`,
    params
  );

  const tasa = await leerTasaGuardada();
  res.json(rows.map((p) => ({
    ...p,
    precio_bs: Number((Number(p.precio_usd) * tasa).toFixed(2)),
  })));
}));

app.get('/api/productos/:id', asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });

  const { rows } = await pool.query(
    `SELECT p.*, c.nombre AS categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.id = $1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });

  const tasa = await leerTasaGuardada();
  const p = rows[0];
  p.precio_bs = Number((Number(p.precio_usd) * tasa).toFixed(2));
  res.json(p);
}));

/* =========================================================
   ADMIN — LOGIN / HTML
   ========================================================= */
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });

  const userOk = String(user).length === ADMIN_USER.length &&
    crypto.timingSafeEqual(Buffer.from(String(user)), Buffer.from(ADMIN_USER));
  const passOk = String(pass).length === ADMIN_PASS.length &&
    crypto.timingSafeEqual(Buffer.from(String(pass)), Buffer.from(ADMIN_PASS));

  if (!userOk || !passOk) return res.status(401).json({ error: 'Credenciales incorrectas' });

  res.json({ ok: true, token: crearToken(user), expira_en_ms: TOKEN_TTL_MS });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.js', (req, res) => res.sendFile(path.join(__dirname, 'admin.js')));

/* =========================================================
   ADMIN — CONFIGURACIÓN DEL SITIO
   ========================================================= */
app.get('/api/admin/config', adminAuth, asyncHandler(async (req, res) => {
  const cfg = await leerConfig();
  res.json(cfg);
}));

app.put('/api/admin/config', adminAuth, asyncHandler(async (req, res) => {
  const { nombre_negocio, hero_titulo, hero_texto, logo_url, whatsapp_number } = req.body || {};

  if (nombre_negocio !== undefined) {
    if (!String(nombre_negocio).trim()) {
      return res.status(400).json({ error: 'El nombre del negocio no puede estar vacío' });
    }
    await guardarConfig('nombre_negocio', String(nombre_negocio).trim());
  }
  if (hero_titulo !== undefined) await guardarConfig('hero_titulo', String(hero_titulo).trim());
  if (hero_texto !== undefined) await guardarConfig('hero_texto', String(hero_texto).trim());
  if (logo_url !== undefined) await guardarConfig('logo_url', String(logo_url).trim());
  if (whatsapp_number !== undefined) {
    const soloDigitos = String(whatsapp_number).replace(/\D/g, '');
    await guardarConfig('whatsapp_number', soloDigitos);
  }

  const cfg = await leerConfig();
  res.json({ ok: true, ...cfg });
}));

/* =========================================================
   ADMIN — CRUD PRODUCTOS
   ========================================================= */
app.post('/api/admin/productos', adminAuth, asyncHandler(async (req, res) => {
  const { nombre, descripcion, precio_usd, imagen_url, categoria_id, disponible, destacado } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  const usd = toNumber(precio_usd);
  if (usd === null) return res.status(400).json({ error: 'El campo "precio_usd" es obligatorio' });

  const { rows } = await pool.query(
    `INSERT INTO productos (nombre, descripcion, precio_usd, imagen_url, categoria_id, disponible, destacado)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [String(nombre).trim(), descripcion || null, usd, imagen_url || null,
     toNumber(categoria_id), toBool(disponible, true), toBool(destacado, false)]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/admin/productos/:id', adminAuth, asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, descripcion, precio_usd, imagen_url, categoria_id, disponible, destacado } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE productos SET
       nombre = COALESCE($1, nombre),
       descripcion = COALESCE($2, descripcion),
       precio_usd = COALESCE($3, precio_usd),
       imagen_url = COALESCE($4, imagen_url),
       categoria_id = COALESCE($5, categoria_id),
       disponible = COALESCE($6, disponible),
       destacado = COALESCE($7, destacado)
     WHERE id = $8 RETURNING *`,
    [nombre ? String(nombre).trim() : null, descripcion ?? null, toNumber(precio_usd),
     imagen_url ?? null, toNumber(categoria_id),
     disponible === undefined ? null : toBool(disponible, true),
     destacado === undefined ? null : toBool(destacado, false), id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(rows[0]);
}));

app.delete('/api/admin/productos/:id', adminAuth, asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });
  const { rowCount } = await pool.query('DELETE FROM productos WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ok: true, deleted: id });
}));

/* =========================================================
   ADMIN — CRUD CATEGORÍAS
   ========================================================= */
app.post('/api/admin/categorias', adminAuth, asyncHandler(async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre obligatorio' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre) VALUES ($1) RETURNING *`,
      [String(nombre).trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Esa categoría ya existe' });
    throw err;
  }
}));

app.put('/api/admin/categorias/:id', adminAuth, asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });
  const { nombre } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre obligatorio' });
  try {
    const { rows } = await pool.query(
      `UPDATE categorias SET nombre = $1 WHERE id = $2 RETURNING *`,
      [String(nombre).trim(), id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Esa categoría ya existe' });
    throw err;
  }
}));

app.delete('/api/admin/categorias/:id', adminAuth, asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });
  const { rowCount } = await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Categoría no encontrada' });
  res.json({ ok: true, deleted: id });
}));

/* =========================================================
   ADMIN — TASA BCV
   ========================================================= */
app.post('/api/admin/tasa/refrescar', adminAuth, asyncHandler(async (req, res) => {
  const tasa = await actualizarTasaBCV();
  if (tasa === null) return res.status(502).json({ error: 'No se pudo obtener la tasa' });
  res.json({ ok: true, tasa_bcv: tasa });
}));

app.post('/api/admin/tasa', adminAuth, asyncHandler(async (req, res) => {
  const { tasa } = req.body || {};
  const n = toNumber(tasa);
  if (n === null || n <= 0) return res.status(400).json({ error: 'Tasa inválida' });
  await guardarConfig('tasa_bcv', n);
  res.json({ ok: true, tasa_bcv: n });
}));

/* =========================================================
   UPLOADS
   ========================================================= */
app.post('/api/uploads', upload.single('imagen'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  const filename = `producto-${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
  const filepath = path.join(UPLOADS_DIR, filename);

  await sharp(req.file.buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(filepath);

  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.status(201).json({ ok: true, filename, url: `${base.replace(/\/+$/, '')}/uploads/${filename}` });
}));

/* =========================================================
   ERRORES
   ========================================================= */
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Imagen mayor a 8 MB' });
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  }
  if (err.message && err.message.includes('CORS')) return res.status(403).json({ error: err.message });
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

/* =========================================================
   ARRANQUE
   ========================================================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API escuchando en http://0.0.0.0:${PORT}`);
  console.log(`   Admin en /admin (usuario: ${ADMIN_USER})`);
});
