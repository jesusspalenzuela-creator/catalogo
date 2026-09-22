/* =========================================================
   CATÁLOGO API — Node.js + Express + PostgreSQL
   ========================================================= */

require('dotenv').config();

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
   CORS
   FRONTEND_URL admite varios orígenes separados por coma.
   En desarrollo: FRONTEND_URL=http://localhost:5500,http://127.0.0.1:5500
   En producción : FRONTEND_URL=https://midominio.com,https://www.midominio.com
   --------------------------------------------------------- */
const allowedOrigins = String(process.env.FRONTEND_URL || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Permitir peticiones sin Origin (curl, Postman, server-to-server)
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
  ssl:
    String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[PG] Error inesperado en el pool:', err.message);
});

/* ---------------------------------------------------------
   Uploads (almacenamiento en disco, NO en PostgreSQL)
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
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB máximo de entrada
  fileFilter(req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten archivos de imagen'));
    }
    cb(null, true);
  },
});

/* ---------------------------------------------------------
   Helpers
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
   Health check
   --------------------------------------------------------- */
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'catalogo-api', time: new Date().toISOString() });
});

app.get('/api/health', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT NOW() AS now');
  res.json({ ok: true, db: rows[0].now });
}));

/* =========================================================
   CATEGORÍAS
   ========================================================= */
app.get('/api/categorias', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, created_at
       FROM categorias
      ORDER BY nombre ASC`
  );
  res.json(rows);
}));

/* =========================================================
   PRODUCTOS
   ========================================================= */
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
  if (destacado === 'true') {
    conditions.push('p.destacado = TRUE');
  }
  if (disponible === 'true')  conditions.push('p.disponible = TRUE');
  if (disponible === 'false') conditions.push('p.disponible = FALSE');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.descripcion, p.precio_usd, p.precio_bs, p.imagen_url,
            p.categoria_id, p.disponible, p.destacado, p.created_at,
            c.nombre AS categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       ${where}
      ORDER BY p.destacado DESC, p.created_at DESC`,
    params
  );

  res.json(rows);
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
  res.json(rows[0]);
}));

app.post('/api/productos', asyncHandler(async (req, res) => {
  const {
    nombre, descripcion, precio_usd, precio_bs,
    imagen_url, categoria_id, disponible, destacado,
  } = req.body || {};

  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  }
  const usd = toNumber(precio_usd);
  if (usd === null) {
    return res.status(400).json({ error: 'El campo "precio_usd" es obligatorio y numérico' });
  }

  const { rows } = await pool.query(
    `INSERT INTO productos
       (nombre, descripcion, precio_usd, precio_bs, imagen_url, categoria_id, disponible, destacado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      String(nombre).trim(),
      descripcion || null,
      usd,
      toNumber(precio_bs),
      imagen_url || null,
      toNumber(categoria_id),
      toBool(disponible, true),
      toBool(destacado, false),
    ]
  );

  res.status(201).json(rows[0]);
}));

app.put('/api/productos/:id', asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });

  const exists = await pool.query('SELECT id FROM productos WHERE id = $1', [id]);
  if (!exists.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });

  const {
    nombre, descripcion, precio_usd, precio_bs,
    imagen_url, categoria_id, disponible, destacado,
  } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE productos SET
       nombre       = COALESCE($1, nombre),
       descripcion  = COALESCE($2, descripcion),
       precio_usd   = COALESCE($3, precio_usd),
       precio_bs    = COALESCE($4, precio_bs),
       imagen_url   = COALESCE($5, imagen_url),
       categoria_id = COALESCE($6, categoria_id),
       disponible   = COALESCE($7, disponible),
       destacado    = COALESCE($8, destacado)
     WHERE id = $9
     RETURNING *`,
    [
      nombre ? String(nombre).trim() : null,
      descripcion ?? null,
      toNumber(precio_usd),
      toNumber(precio_bs),
      imagen_url ?? null,
      toNumber(categoria_id),
      disponible === undefined ? null : toBool(disponible, true),
      destacado  === undefined ? null : toBool(destacado, false),
      id,
    ]
  );

  res.json(rows[0]);
}));

app.delete('/api/productos/:id', asyncHandler(async (req, res) => {
  const id = toNumber(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID inválido' });

  const { rowCount } = await pool.query('DELETE FROM productos WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Producto no encontrado' });

  res.json({ ok: true, deleted: id });
}));

/* =========================================================
   SUBIDA DE IMÁGENES
   Procesa con Sharp: rota, redimensiona, convierte a WebP y comprime.
   Devuelve la URL pública para guardarla en PostgreSQL.
   ========================================================= */
app.post(
  '/api/uploads',
  upload.single('imagen'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo en el campo "imagen"' });
    }

    const filename = `producto-${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
    const filepath = path.join(UPLOADS_DIR, filename);

    await sharp(req.file.buffer)
      .rotate() // respeta orientación EXIF
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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'La imagen supera el tamaño máximo de 8 MB' });
    }
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  }

  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: err.message });
  }

  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

/* =========================================================
   ARRANQUE
   ========================================================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API del catálogo escuchando en http://0.0.0.0:${PORT}`);
  console.log(`   Orígenes permitidos: ${allowedOrigins.join(', ') || '(ninguno)'}`);
});