/* =========================================================
   CATÁLOGO API — Node.js + Express + PostgreSQL
   Con tasa BCV automática y panel de administración.
   ========================================================= */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const sharp   = require('sharp');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ---------------------------------------------------------
   CONFIGURACIÓN DESDE VARIABLES DE ENTORNO (EasyPanel)
   --------------------------------------------------------- */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'cambiar_esto';

/* ---------------------------------------------------------
   CORS
   --------------------------------------------------------- */
const allowedOrigins = String(process.env.FRONTEND_URL || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  })
);

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

pool.on('error', (err) => {
  console.error('[PG] Error inesperado en el pool:', err.message);
});

/* ---------------------------------------------------------
   Uploads
   --------------------------------------------------------- */
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

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
   AUTENTICACIÓN BASIC PARA EL PANEL ADMIN
   --------------------------------------------------------- */
function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Autenticación requerida');
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();

  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Credenciales incorrectas');
}

/* ---------------------------------------------------------
   TASA BCV — scraping + caché en PostgreSQL
   --------------------------------------------------------- */
async function leerTasaBCV() {
  const res = await fetch('https://www.bcv.org.ve/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) throw new Error(`BCV respondió HTTP ${res.status}`);

  const html = await res.text();

  // El BCV coloca la tasa dentro de un <div id="dolar"> ... <strong>301,37</strong>
  const match = html.match(
    /id=["']dolar["'][\s\S]*?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i
  );

  if (!match) throw new Error('No se pudo extraer la tasa del HTML del BCV');

  // Convertir formato venezolano "1.234,56" → 1234.56
  const numero = match[1].replace(/\./g, '').replace(',', '.');
  const tasa = parseFloat(numero);

  if (!Number.isFinite(tasa) || tasa <= 0) {
    throw new Error(`Tasa BCV inválida: ${match[1]}`);
  }
  return tasa;
}

async function guardarTasa(tasa) {
  await pool.query(
    `INSERT INTO configuracion (clave, valor, updated_at)
     VALUES ('tasa_bcv', $1, NOW())
     ON CONFLICT (clave)
     DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
    [String(tasa)]
  );
}

async function leerTasaGuardada() {
  const { rows } = await pool.query(
    `SELECT valor FROM configuracion WHERE clave = 'tasa_bcv'`
  );
  return rows.length ? parseFloat(rows[0].valor) : 0;
}

async function actualizarTasaBCV() {
  try {
    const tasa = await leerTasaBCV();
    await guardarTasa(tasa);
    console.log(`[BCV] Tasa actualizada: ${tasa} Bs/USD`);
    return tasa;
  } catch (err) {
    console.error('[BCV] Error al actualizar:', err.message);
    return null;
  }
}

// Actualiza al arrancar y luego cada 12 horas
actualizarTasaBCV();
setInterval(actualizarTasaBCV, 12 * 60 * 60 * 1000);

/* ---------------------------------------------------------
   HEALTH
   --------------------------------------------------------- */
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'catalogo-api', time: new Date().toISOString() });
});

app.get(
  '/api/health',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, db: rows[0].now });
  })
);

app.get(
  '/api/tasa-bcv',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT valor, updated_at FROM configuracion WHERE clave = 'tasa_bcv'`
    );
    const tasa = rows.length ? parseFloat(rows[0].valor) : 0;
    res.json({ tasa_bcv: tasa, updated_at: rows[0]?.updated_at || null });
  })
);

/* =========================================================
   CATEGORÍAS (público)
   ========================================================= */
app.get(
  '/api/categorias',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, nombre, created_at FROM categorias ORDER BY nombre ASC`
    );
    res.json(rows);
  })
);

/* =========================================================
   PRODUCTOS (público) — precio_bs se calcula con la tasa BCV
   ========================================================= */
app.get(
  '/api/productos',
  asyncHandler(async (req, res) => {
    const { categoria_id, q, destacado, disponible } = req.query;

    const conditions = [];
    const params = [];

    if (categoria_id) {
      params.push(categoria_id);
      conditions.push(`p.categoria_id = $${params.length}`);
    }
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      conditions.push(
        `(p.nombre ILIKE $${params.length} OR p.descripcion ILIKE $${params.length})`
      );
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

    // Calcular precio_bs en vivo con la tasa BCV actual
    const tasa = await leerTasaGuardada();
    const productos = rows.map((p) => ({
      ...p,
      precio_bs: Number((Number(p.precio_usd) * tasa).toFixed(2)),
    }));

    res.json(productos);
  })
);

app.get(
  '/api/productos/:id',
  asyncHandler(async (req, res) => {
    const id = toNumber(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID inválido' });

    const { rows } = await pool.query(
      `SELECT p.*, c.nombre AS categoria_nombre
         FROM productos p
         LEFT JOIN categorias c ON c.id = p.categoria_id
        WHERE p.id = $1`,
      [id]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'Producto no encontrado' });

    const tasa = await leerTasaGuardada();
    const p = rows[0];
    p.precio_bs = Number((Number(p.precio_usd) * tasa).toFixed(2));
    res.json(p);
  })
);

/* =========================================================
   PANEL ADMIN — HTML + JS servidos por Express
   ========================================================= */
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.js', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.js'));
});

/* =========================================================
   ADMIN — CRUD protegido
   ========================================================= */
app.post(
  '/api/admin/productos',
  adminAuth,
  asyncHandler(async (req, res) => {
    const {
      nombre,
      descripcion,
      precio_usd,
      imagen_url,
      categoria_id,
      disponible,
      destacado,
    } = req.body || {};

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
    }

    const usd = toNumber(precio_usd);
    if (usd === null) {
      return res
        .status(400)
        .json({ error: 'El campo "precio_usd" es obligatorio y numérico' });
    }

    const { rows } = await pool.query(
      `INSERT INTO productos
         (nombre, descripcion, precio_usd, imagen_url,
          categoria_id, disponible, destacado)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        String(nombre).trim(),
        descripcion || null,
        usd,
        imagen_url || null,
        toNumber(categoria_id),
        toBool(disponible, true),
        toBool(destacado, false),
      ]
    );

    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/admin/productos/:id',
  adminAuth,
  asyncHandler(async (req, res) => {
    const id = toNumber(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID inválido' });

    const {
      nombre,
      descripcion,
      precio_usd,
      imagen_url,
      categoria_id,
      disponible,
      destacado,
    } = req.body || {};

    const { rows } = await pool.query(
      `UPDATE productos SET
         nombre       = COALESCE($1, nombre),
         descripcion  = COALESCE($2, descripcion),
         precio_usd   = COALESCE($3, precio_usd),
         imagen_url   = COALESCE($4, imagen_url),
         categoria_id = COALESCE($5, categoria_id),
         disponible   = COALESCE($6, disponible),
         destacado    = COALESCE($7, destacado)
       WHERE id = $8
       RETURNING *`,
      [
        nombre ? String(nombre).trim() : null,
        descripcion ?? null,
        toNumber(precio_usd),
        imagen_url ?? null,
        toNumber(categoria_id),
        disponible === undefined ? null : toBool(disponible, true),
        destacado === undefined ? null : toBool(destacado, false),
        id,
      ]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/admin/productos/:id',
  adminAuth,
  asyncHandler(async (req, res) => {
    const id = toNumber(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID inválido' });

    const { rowCount } = await pool.query('DELETE FROM productos WHERE id = $1', [
      id,
    ]);
    if (!rowCount)
      return res.status(404).json({ error: 'Producto no encontrado' });

    res.json({ ok: true, deleted: id });
  })
);

/* =========================================================
   SUBIDA DE IMÁGENES
   --------------------------------------------------------- */
app.post(
  '/api/uploads',
  upload.single('imagen'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'No se recibió ningún archivo en el campo "imagen"' });
    }

    const filename = `producto-${Date.now()}-${Math.round(
      Math.random() * 1e6
    )}.webp`;
    const filepath = path.join(UPLOADS_DIR, filename);

    await sharp(req.file.buffer)
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toFile(filepath);

    const base =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get('host')}`;

    res.status(201).json({
      ok: true,
      filename,
      url: `${base.replace(/\/+$/, '')}/uploads/${filename}`,
    });
  })
);

/* =========================================================
   MANEJO DE ERRORES
   ========================================================= */
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(413)
        .json({ error: 'La imagen supera el tamaño máximo de 8 MB' });
    }
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  }

  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: err.message });
  }

  res
    .status(err.status || 500)
    .json({ error: err.message || 'Error interno del servidor' });
});

/* =========================================================
   ARRANQUE
   ========================================================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API del catálogo escuchando en http://0.0.0.0:${PORT}`);
  console.log(`   Panel admin en /admin (usuario: ${ADMIN_USER})`);
});
