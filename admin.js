/* =========================================================
   PANEL ADMIN — lógica
   ========================================================= */
(function () {
  'use strict';

  const API = '';
  const TOKEN_KEY = 'admin_token';
  const USER_KEY = 'admin_user';

  const el = {
    loginView: document.getElementById('loginView'),
    appView: document.getElementById('appView'),
    loginForm: document.getElementById('loginForm'),
    loginUser: document.getElementById('loginUser'),
    loginPass: document.getElementById('loginPass'),
    loginMsg: document.getElementById('loginMsg'),
    userName: document.getElementById('userName'),
    btnLogout: document.getElementById('btnLogout'),

    form: document.getElementById('formProducto'),
    formTitulo: document.getElementById('formTitulo'),
    productoId: document.getElementById('productoId'),
    nombre: document.getElementById('nombre'),
    categoria_id: document.getElementById('categoria_id'),
    precio_usd: document.getElementById('precio_usd'),
    precio_bs_preview: document.getElementById('precio_bs_preview'),
    descripcion: document.getElementById('descripcion'),
    imagen: document.getElementById('imagen'),
    preview: document.getElementById('preview'),
    disponible: document.getElementById('disponible'),
    destacado: document.getElementById('destacado'),
    btnGuardar: document.getElementById('btnGuardar'),
    btnCancelar: document.getElementById('btnCancelar'),
    mensaje: document.getElementById('mensaje'),
    tablaProductos: document.getElementById('tablaProductos'),
    productosCount: document.getElementById('productosCount'),

    formCategoria: document.getElementById('formCategoria'),
    categoriaNombre: document.getElementById('categoriaNombre'),
    categoriaMsg: document.getElementById('categoriaMsg'),
    tablaCategorias: document.getElementById('tablaCategorias'),

    formApariencia: document.getElementById('formApariencia'),
    cfgNombre: document.getElementById('cfgNombre'),
    cfgTitulo: document.getElementById('cfgTitulo'),
    cfgTexto: document.getElementById('cfgTexto'),
    cfgLogo: document.getElementById('cfgLogo'),
    cfgWhatsapp: document.getElementById('cfgWhatsapp'),
    logoPreview: document.getElementById('logoPreview'),
    btnQuitarLogo: document.getElementById('btnQuitarLogo'),
    aparienciaMsg: document.getElementById('aparienciaMsg'),

    tasaValor: document.getElementById('tasaValor'),
    tasaUpdated: document.getElementById('tasaUpdated'),
    tasaManual: document.getElementById('tasaManual'),
    btnRefrescar: document.getElementById('btnRefrescar'),
    btnGuardarTasa: document.getElementById('btnGuardarTasa'),
    tasaMsg: document.getElementById('tasaMsg'),
  };

  let categorias = [];
  let productos = [];
  let tasaBCV = 0;
  let logoActual = '';
  let subiendoLogo = false;

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  function fmtBs(n) {
    return 'Bs. ' + (Number(n) || 0).toLocaleString('es-VE', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function fmtUsd(n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function showMsg(elMsg, text, ok = true) {
    elMsg.textContent = text;
    elMsg.className = 'msg ' + (ok ? 'ok' : 'err');
    setTimeout(() => { elMsg.className = 'msg'; }, 4000);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token && path.startsWith('/api/admin')) headers.Authorization = 'Bearer ' + token;

    const res = await fetch(API + path, { ...opts, headers });
    if (res.status === 401) {
      clearToken(); mostrarLogin();
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const d = await res.json(); if (d.error) detail = d.error; } catch {}
      throw new Error(detail);
    }
    return res.json();
  }

  function mostrarLogin() {
    el.appView.classList.remove('visible');
    el.loginView.classList.remove('hidden');
  }
  function mostrarApp() {
    el.loginView.classList.add('hidden');
    el.appView.classList.add('visible');
    el.userName.textContent = localStorage.getItem(USER_KEY) || 'admin';
  }

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.loginForm.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Ingresando…';
    try {
      const res = await fetch(API + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: el.loginUser.value.trim(), pass: el.loginPass.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
      setToken(data.token);
      localStorage.setItem(USER_KEY, el.loginUser.value.trim());
      el.loginPass.value = '';
      mostrarApp();
      await cargarTodo();
    } catch (err) {
      showMsg(el.loginMsg, err.message, false);
    } finally {
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  });

  el.btnLogout.addEventListener('click', () => { clearToken(); mostrarLogin(); });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('panel-' + t.dataset.tab).classList.add('active');
    });
  });

  /* -------- CARGA -------- */
  async function cargarCategorias() {
    categorias = await api('/api/categorias');
    el.categoria_id.innerHTML = categorias.length
      ? categorias.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')
      : '<option value="">(crea una categoría primero)</option>';
    renderTablaCategorias();
  }

  async function cargarTasa() {
    const data = await api('/api/tasa-bcv');
    tasaBCV = data.tasa_bcv || 0;
    el.tasaValor.textContent = fmtBs(tasaBCV) + ' / $1';
    el.tasaUpdated.textContent = data.updated_at
      ? 'Actualizada: ' + new Date(data.updated_at).toLocaleString('es-VE')
      : 'Sin actualizar aún';
    actualizarPreviewBs();
  }

  async function cargarProductos() {
    productos = await api('/api/productos');
    el.productosCount.textContent =
      productos.length === 1 ? '1 producto' : `${productos.length} productos`;
    renderTablaProductos();
  }

  async function cargarConfig() {
    const cfg = await api('/api/admin/config');
    el.cfgNombre.value = cfg.nombre_negocio || '';
    el.cfgTitulo.value = cfg.hero_titulo || '';
    el.cfgTexto.value = cfg.hero_texto || '';
    el.cfgWhatsapp.value = cfg.whatsapp_number || '';
    logoActual = cfg.logo_url || '';
    renderLogoPreview();
  }

  function renderLogoPreview() {
    if (logoActual) {
      el.logoPreview.innerHTML = `<img src="${logoActual}" alt="">`;
    } else {
      el.logoPreview.textContent = (el.cfgNombre.value || 'M').trim().charAt(0).toUpperCase() || 'M';
    }
  }

  el.cfgNombre.addEventListener('input', renderLogoPreview);

  async function cargarTodo() {
    try {
      await Promise.all([cargarCategorias(), cargarTasa(), cargarProductos(), cargarConfig()]);
    } catch (err) {
      showMsg(el.mensaje, 'Error al cargar datos: ' + err.message, false);
    }
  }

  function actualizarPreviewBs() {
    const usd = parseFloat(el.precio_usd.value) || 0;
    el.precio_bs_preview.value = tasaBCV ? fmtBs(usd * tasaBCV) : '—';
  }
  el.precio_usd.addEventListener('input', actualizarPreviewBs);

  /* -------- PRODUCTOS -------- */
  function renderTablaProductos() {
    if (!productos.length) {
      el.tablaProductos.innerHTML =
        '<tr><td colspan="6" class="empty-row">Aún no hay productos. Crea el primero arriba.</td></tr>';
      return;
    }
    el.tablaProductos.innerHTML = productos.map((p) => `
      <tr>
        <td>${p.imagen_url
          ? `<img src="${p.imagen_url}" alt="">`
          : '<div style="width:46px;height:46px;border-radius:8px;background:#f1f5f9"></div>'}</td>
        <td><strong>${p.nombre}</strong></td>
        <td>${p.categoria_nombre || '—'}</td>
        <td>${fmtUsd(p.precio_usd)}</td>
        <td><strong>${fmtBs(p.precio_bs)}</strong></td>
        <td class="row" style="gap:6px">
          <button class="ghost small" data-editar="${p.id}">Editar</button>
          <button class="danger small" data-eliminar="${p.id}">Eliminar</button>
        </td>
      </tr>
    `).join('');
  }

  function limpiarFormulario() {
    el.form.reset();
    el.productoId.value = '';
    el.formTitulo.textContent = 'Nuevo producto';
    el.btnCancelar.style.display = 'none';
    el.preview.classList.remove('show');
    el.precio_bs_preview.value = '—';
    el.imagen.value = '';
  }

  function cargarEnFormulario(p) {
    el.productoId.value = p.id;
    el.nombre.value = p.nombre;
    el.categoria_id.value = p.categoria_id || '';
    el.precio_usd.value = p.precio_usd;
    el.descripcion.value = p.descripcion || '';
    el.disponible.checked = !!p.disponible;
    el.destacado.checked = !!p.destacado;
    el.formTitulo.textContent = 'Editar producto #' + p.id;
    el.btnCancelar.style.display = 'inline-flex';
    el.imagen.value = '';
    if (p.imagen_url) { el.preview.src = p.imagen_url; el.preview.classList.add('show'); }
    else { el.preview.classList.remove('show'); }
    actualizarPreviewBs();
    document.getElementById('panel-productos').scrollIntoView({ behavior: 'smooth' });
  }

  el.btnCancelar.addEventListener('click', limpiarFormulario);

  el.imagen.addEventListener('change', () => {
    const f = el.imagen.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (e) => { el.preview.src = e.target.result; el.preview.classList.add('show'); };
    r.readAsDataURL(f);
  });

  async function subirImagen(file) {
    const fd = new FormData();
    fd.append('imagen', file);
    const data = await api('/api/uploads', { method: 'POST', body: fd });
    return data.url;
  }

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.btnGuardar.disabled = true; el.btnGuardar.textContent = 'Guardando…';
    try {
      let imagen_url = null;
      if (el.imagen.files[0]) imagen_url = await subirImagen(el.imagen.files[0]);

      const payload = {
        nombre: el.nombre.value.trim(),
        descripcion: el.descripcion.value.trim(),
        precio_usd: parseFloat(el.precio_usd.value),
        categoria_id: parseInt(el.categoria_id.value, 10) || null,
        disponible: el.disponible.checked,
        destacado: el.destacado.checked,
      };

      const id = el.productoId.value;
      if (id) {
        const actual = productos.find((p) => String(p.id) === String(id));
        payload.imagen_url = imagen_url || (actual?.imagen_url ?? null);
        await api('/api/admin/productos/' + id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showMsg(el.mensaje, 'Producto actualizado');
      } else {
        payload.imagen_url = imagen_url;
        await api('/api/admin/productos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showMsg(el.mensaje, 'Producto creado');
      }
      limpiarFormulario();
      await cargarProductos();
    } catch (err) {
      showMsg(el.mensaje, 'Error: ' + err.message, false);
    } finally {
      el.btnGuardar.disabled = false; el.btnGuardar.textContent = 'Guardar producto';
    }
  });

  el.tablaProductos.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-editar]');
    const del = e.target.closest('[data-eliminar]');
    if (edit) {
      const p = productos.find((x) => String(x.id) === edit.dataset.editar);
      if (p) cargarEnFormulario(p);
    }
    if (del) {
      if (!confirm('¿Eliminar este producto?')) return;
      try {
        await api('/api/admin/productos/' + del.dataset.eliminar, { method: 'DELETE' });
        showMsg(el.mensaje, 'Producto eliminado');
        await cargarProductos();
      } catch (err) { showMsg(el.mensaje, 'Error: ' + err.message, false); }
    }
  });

  /* -------- CATEGORÍAS -------- */
  function renderTablaCategorias() {
    if (!categorias.length) {
      el.tablaCategorias.innerHTML =
        '<tr><td colspan="3" class="empty-row">Sin categorías todavía.</td></tr>';
      return;
    }
    el.tablaCategorias.innerHTML = categorias.map((c) => {
      const count = productos.filter((p) => p.categoria_id === c.id).length;
      return `
        <tr>
          <td><strong>${c.nombre}</strong></td>
          <td>${count}</td>
          <td class="row" style="gap:6px">
            <button class="ghost small" data-editcat="${c.id}">Renombrar</button>
            <button class="danger small" data-delcat="${c.id}">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
  }

  el.formCategoria.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = el.categoriaNombre.value.trim();
    if (!nombre) return;
    try {
      await api('/api/admin/categorias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      showMsg(el.categoriaMsg, 'Categoría creada');
      el.categoriaNombre.value = '';
      await cargarCategorias();
    } catch (err) { showMsg(el.categoriaMsg, 'Error: ' + err.message, false); }
  });

  el.tablaCategorias.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-editcat]');
    const del = e.target.closest('[data-delcat]');
    if (edit) {
      const c = categorias.find((x) => String(x.id) === edit.dataset.editcat);
      const nuevo = prompt('Nuevo nombre:', c?.nombre || '');
      if (!nuevo || !nuevo.trim()) return;
      try {
        await api('/api/admin/categorias/' + edit.dataset.editcat, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: nuevo.trim() }),
        });
        showMsg(el.categoriaMsg, 'Categoría actualizada');
        await cargarCategorias();
      } catch (err) { showMsg(el.categoriaMsg, 'Error: ' + err.message, false); }
    }
    if (del) {
      if (!confirm('¿Eliminar esta categoría? Los productos quedarán sin categoría.')) return;
      try {
        await api('/api/admin/categorias/' + del.dataset.delcat, { method: 'DELETE' });
        showMsg(el.categoriaMsg, 'Categoría eliminada');
        await Promise.all([cargarCategorias(), cargarProductos()]);
      } catch (err) { showMsg(el.categoriaMsg, 'Error: ' + err.message, false); }
    }
  });

  /* -------- APARIENCIA -------- */
  el.cfgLogo.addEventListener('change', async () => {
    const f = el.cfgLogo.files[0];
    if (!f) return;
    subiendoLogo = true;
    el.logoPreview.innerHTML = '<div style="font-size:.8rem;color:#64748b">Subiendo…</div>';
    try {
      const url = await subirImagen(f);
      logoActual = url;
      renderLogoPreview();
    } catch (err) {
      showMsg(el.aparienciaMsg, 'Error al subir logo: ' + err.message, false);
      renderLogoPreview();
    } finally {
      subiendoLogo = false;
      el.cfgLogo.value = '';
    }
  });

  el.btnQuitarLogo.addEventListener('click', () => {
    logoActual = '';
    renderLogoPreview();
  });

  el.formApariencia.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (subiendoLogo) {
      showMsg(el.aparienciaMsg, 'Espera a que termine la subida del logo', false);
      return;
    }
    try {
      await api('/api/admin/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_negocio: el.cfgNombre.value.trim(),
          hero_titulo: el.cfgTitulo.value.trim(),
          hero_texto: el.cfgTexto.value.trim(),
          logo_url: logoActual,
          whatsapp_number: el.cfgWhatsapp.value.trim(),
        }),
      });
      showMsg(el.aparienciaMsg, 'Cambios guardados');
      await cargarConfig();
    } catch (err) {
      showMsg(el.aparienciaMsg, 'Error: ' + err.message, false);
    }
  });

  /* -------- TASA -------- */
  el.btnRefrescar.addEventListener('click', async () => {
    el.btnRefrescar.disabled = true; el.btnRefrescar.textContent = 'Actualizando…';
    try {
      const r = await api('/api/admin/tasa/refrescar', { method: 'POST' });
      showMsg(el.tasaMsg, 'Tasa actualizada a ' + fmtBs(r.tasa_bcv));
      await cargarTasa();
    } catch (err) { showMsg(el.tasaMsg, 'Error: ' + err.message, false); }
    finally { el.btnRefrescar.disabled = false; el.btnRefrescar.textContent = 'Forzar actualización'; }
  });

  el.btnGuardarTasa.addEventListener('click', async () => {
    const tasa = parseFloat(el.tasaManual.value);
    if (!tasa || tasa <= 0) { showMsg(el.tasaMsg, 'Introduce una tasa válida', false); return; }
    try {
      await api('/api/admin/tasa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasa }),
      });
      showMsg(el.tasaMsg, 'Tasa guardada manualmente');
      el.tasaManual.value = '';
      await cargarTasa();
      await cargarProductos();
    } catch (err) { showMsg(el.tasaMsg, 'Error: ' + err.message, false); }
  });

  /* -------- INIT -------- */
  (async function init() {
    if (getToken()) {
      try { await cargarTodo(); mostrarApp(); return; }
      catch { clearToken(); }
    }
    mostrarLogin();
  })();
})();
