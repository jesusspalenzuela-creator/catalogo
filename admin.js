/* =========================================================
   PANEL ADMIN — lógica
   ========================================================= */
(function () {
  'use strict';

  const API = ''; // mismo origen

  const el = {
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
    tabla: document.getElementById('tablaProductos'),
    tasaActual: document.getElementById('tasaActual'),
    btnRefrescarTasa: document.getElementById('btnRefrescarTasa'),
  };

  let categorias = [];
  let productos = [];
  let tasaBCV = 0;

  /* ---------------- helpers ---------------- */
  function fmtBs(n) {
    return 'Bs. ' + (Number(n) || 0).toLocaleString('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function fmtUsd(n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function showMsg(text, ok = true) {
    el.mensaje.textContent = text;
    el.mensaje.className = 'msg ' + (ok ? 'ok' : 'err');
    setTimeout(() => {
      el.mensaje.className = 'msg';
    }, 4000);
  }

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const d = await res.json();
        if (d.error) detail = d.error;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  }

  async function cargarCategorias() {
    categorias = await api('/api/categorias');
    el.categoria_id.innerHTML = categorias
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('');
  }

  async function cargarTasa() {
    const data = await api('/api/tasa-bcv');
    tasaBCV = data.tasa_bcv || 0;
    el.tasaActual.textContent = fmtBs(tasaBCV) + ' / $1';
    actualizarPreviewBs();
  }

  async function cargarProductos() {
    productos = await api('/api/productos');
    renderTabla();
  }

  /* ---------------- preview Bs ---------------- */
  function actualizarPreviewBs() {
    const usd = parseFloat(el.precio_usd.value) || 0;
    el.precio_bs_preview.value = tasaBCV ? fmtBs(usd * tasaBCV) : '—';
  }

  /* ---------------- tabla ---------------- */
  function renderTabla() {
    el.tabla.innerHTML = productos
      .map(
        (p) => `
      <tr data-id="${p.id}">
        <td>${
          p.imagen_url
            ? `<img src="${p.imagen_url}" alt="">`
            : '<div style="width:44px;height:44px;border-radius:8px;background:#f1f5f9"></div>'
        }</td>
        <td>${p.nombre}</td>
        <td>${p.categoria_nombre || '—'}</td>
        <td>${fmtUsd(p.precio_usd)}</td>
        <td>${fmtBs(p.precio_bs)}</td>
        <td>
          <button class="ghost" data-editar="${p.id}" style="height:34px;padding:0 12px;font-size:.8rem">Editar</button>
          <button class="danger" data-eliminar="${p.id}" style="height:34px;padding:0 12px;font-size:.8rem">Eliminar</button>
        </td>
      </tr>`
      )
      .join('');
  }

  /* ---------------- formulario ---------------- */
  function limpiarFormulario() {
    el.form.reset();
    el.productoId.value = '';
    el.formTitulo.textContent = 'Nuevo producto';
    el.btnCancelar.style.display = 'none';
    el.preview.classList.remove('show');
    el.precio_bs_preview.value = '—';
  }

  function cargarEnFormulario(p) {
    el.productoId.value = p.id;
    el.nombre.value = p.nombre;
    el.categoria_id.value = p.categoria_id || '';
    el.precio_usd.value = p.precio_usd;
    el.descripcion.value = p.descripcion || '';
    el.disponible.checked = p.disponible;
    el.destacado.checked = p.destacado;
    el.formTitulo.textContent = 'Editar producto #' + p.id;
    el.btnCancelar.style.display = 'inline-flex';
    if (p.imagen_url) {
      el.preview.src = p.imagen_url;
      el.preview.classList.add('show');
    } else {
      el.preview.classList.remove('show');
    }
    actualizarPreviewBs();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- subir imagen ---------------- */
  async function subirImagen(file) {
    const fd = new FormData();
    fd.append('imagen', file);
    const data = await api('/api/uploads', { method: 'POST', body: fd });
    return data.url;
  }

  /* ---------------- eventos ---------------- */
  el.precio_usd.addEventListener('input', actualizarPreviewBs);

  el.imagen.addEventListener('change', () => {
    const f = el.imagen.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      el.preview.src = e.target.result;
      el.preview.classList.add('show');
    };
    reader.readAsDataURL(f);
  });

  el.btnCancelar.addEventListener('click', limpiarFormulario);

  el.btnRefrescarTasa.addEventListener('click', async () => {
    el.btnRefrescarTasa.disabled = true;
    el.btnRefrescarTasa.textContent = 'Actualizando…';
    try {
      // Forzamos al backend pidiendo health, la tasa se refresca en background
      await api('/api/tasa-bcv');
      await cargarTasa();
      showMsg('Tasa BCV actualizada');
    } catch (e) {
      showMsg('Error al actualizar tasa: ' + e.message, false);
    } finally {
      el.btnRefrescarTasa.disabled = false;
      el.btnRefrescarTasa.textContent = 'Actualizar tasa';
    }
  });

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.btnGuardar.disabled = true;
    el.btnGuardar.textContent = 'Guardando…';

    try {
      let imagen_url = null;

      // Si hay archivo nuevo, subirlo
      if (el.imagen.files[0]) {
        imagen_url = await subirImagen(el.imagen.files[0]);
      }

      const payload = {
        nombre: el.nombre.value.trim(),
        descripcion: el.descripcion.value.trim(),
        precio_usd: parseFloat(el.precio_usd.value),
        categoria_id: parseInt(el.categoria_id.value, 10),
        disponible: el.disponible.checked,
        destacado: el.destacado.checked,
      };

      // Si no hay imagen nueva, conservar la que tenía (solo en edición)
      const id = el.productoId.value;
      if (id) {
        const actual = productos.find((p) => String(p.id) === String(id));
        payload.imagen_url = imagen_url || (actual?.imagen_url ?? null);
        await api('/api/admin/productos/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showMsg('Producto actualizado');
      } else {
        payload.imagen_url = imagen_url;
        await api('/api/admin/productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showMsg('Producto creado');
      }

      limpiarFormulario();
      await cargarProductos();
    } catch (err) {
      showMsg('Error: ' + err.message, false);
    } finally {
      el.btnGuardar.disabled = false;
      el.btnGuardar.textContent = 'Guardar producto';
    }
  });

  el.tabla.addEventListener('click', async (e) => {
    const btnEdit = e.target.closest('[data-editar]');
    const btnDel = e.target.closest('[data-eliminar]');

    if (btnEdit) {
      const p = productos.find((x) => String(x.id) === btnEdit.dataset.editar);
      if (p) cargarEnFormulario(p);
    }

    if (btnDel) {
      if (!confirm('¿Eliminar este producto?')) return;
      try {
        await api('/api/admin/productos/' + btnDel.dataset.eliminar, {
          method: 'DELETE',
        });
        showMsg('Producto eliminado');
        await cargarProductos();
      } catch (err) {
        showMsg('Error: ' + err.message, false);
      }
    }
  });

  /* ---------------- init ---------------- */
  (async function init() {
    try {
      await cargarCategorias();
      await cargarTasa();
      await cargarProductos();
    } catch (err) {
      showMsg('Error al cargar datos: ' + err.message, false);
    }
  })();
})();
