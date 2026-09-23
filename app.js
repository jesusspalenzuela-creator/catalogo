/* =========================================================
   CATÁLOGO — Lógica del frontend
   ========================================================= */
(function () {
  'use strict';

  const CONFIG  = window.CATALOGO_CONFIG || {};
  const API_URL = String(CONFIG.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const WHATSAPP_FALLBACK = String(CONFIG.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const STORAGE_KEY = 'catalogo_carrito_v1';

  const state = {
    productos: [],
    categorias: [],
    categoriaActiva: 'all',
    busqueda: '',
    carrito: [],
    config: {
      nombre_negocio: 'Mi Negocio',
      hero_titulo: 'Todo lo que necesitas, en un solo lugar',
      hero_texto: 'Explora nuestro catálogo con productos seleccionados, precios actualizados y envíos a todo el país.',
      logo_url: '',
      whatsapp_number: '',
    },
  };

  const el = {
    categoriesBar: document.getElementById('categoriesBar'),
    grid:          document.getElementById('productsGrid'),
    loading:       document.getElementById('loadingState'),
    empty:         document.getElementById('emptyState'),
    search:        document.getElementById('searchInput'),
    cartButton:    document.getElementById('cartButton'),
    cartCount:     document.getElementById('cartCount'),
    cartDrawer:    document.getElementById('cartDrawer'),
    cartOverlay:   document.getElementById('cartOverlay'),
    cartClose:     document.getElementById('cartClose'),
    cartItems:     document.getElementById('cartItems'),
    cartTotalBs:   document.getElementById('cartTotalBs'),
    cartTotalUsd:  document.getElementById('cartTotalUsd'),
    cartCheckout:  document.getElementById('cartCheckout'),
    catalogTitle:  document.getElementById('catalogTitle'),
    catalogCount:  document.getElementById('catalogCount'),
    year:          document.getElementById('year'),
    brandMark:     document.getElementById('brandMark'),
    brandName:     document.getElementById('brandName'),
    heroTitulo:    document.getElementById('heroTitulo'),
    heroTexto:     document.getElementById('heroTexto'),
    footerNombre:  document.getElementById('footerNombre'),
    toast:         document.getElementById('toast'),
    docTitle:      document.querySelector('title'),

    // modal de pedido
    checkoutOverlay: document.getElementById('checkoutOverlay'),
    checkoutModal:   document.getElementById('checkoutModal'),
    checkoutBody:    document.getElementById('checkoutBody'),
    checkoutClose:   document.getElementById('checkoutClose'),
    checkoutCancel:  document.getElementById('checkoutCancel'),
    checkoutConfirm: document.getElementById('checkoutConfirm'),
    checkoutCount:   document.getElementById('checkoutCount'),
    checkoutTotalBs: document.getElementById('checkoutTotalBs'),
    checkoutTotalUsd:document.getElementById('checkoutTotalUsd'),
  };

  /* ---------------- UTILIDADES ---------------- */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtBs(value) {
    const n = Number(value) || 0;
    return 'Bs. ' + n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtUsd(value) {
    const n = Number(value) || 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function debounce(fn, ms) {
    let t;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /* ---------------- PLACEHOLDER GENÉRICO ----------------
     Bolsa de compras genérica: sirve para cualquier negocio.
     ------------------------------------------------------ */
  const PLACEHOLDER_IMG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#eff6ff"/>
            <stop offset="100%" stop-color="#f1f5f9"/>
          </linearGradient>
        </defs>
        <rect width="400" height="300" fill="url(#g)"/>
        <g transform="translate(148,100)" fill="none" stroke="#94a3b8" stroke-width="3"
           stroke-linejoin="round" stroke-linecap="round">
          <rect x="0" y="24" width="104" height="88" rx="10"/>
          <path d="M26 24 V14 a26 26 0 0 1 52 0 V24"/>
          <path d="M22 44 L82 44" stroke-opacity=".45"/>
        </g>
      </svg>`
    );

  /* ---------------- TOAST ---------------- */
  let toastTimer = null;
  function mostrarToast(texto) {
    if (!el.toast) return;
    el.toast.innerHTML = `<span class="toast__icon">✓</span><div>${texto}</div>`;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
  }

  /* ---------------- PERSISTENCIA ---------------- */
  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map((it) => ({
        id: Number(it.id),
        nombre: String(it.nombre || ''),
        precio_usd: Number(it.precio_usd) || 0,
        precio_bs: Number(it.precio_bs) || 0,
        imagen_url: it.imagen_url || null,
        cantidad: Math.max(1, Number(it.cantidad) || 1),
      })).filter((it) => Number.isFinite(it.id));
    } catch { return []; }
  }
  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.carrito)); } catch {}
  }

  /* ---------------- API ---------------- */
  async function fetchJSON(path) {
    const res = await fetch(`${API_URL}${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const d = await res.json(); if (d.error) detail = d.error; } catch {}
      throw new Error(detail);
    }
    return res.json();
  }

  async function cargarConfig() {
    try {
      const cfg = await fetchJSON('/api/config');
      state.config = Object.assign(state.config, cfg);
    } catch (err) {
      console.warn('No se pudo cargar la configuración:', err.message);
    }
  }

  function aplicarConfig() {
    const c = state.config;
    if (el.brandName) el.brandName.textContent = c.nombre_negocio || 'Mi Negocio';

    // Logo o letra inicial
    if (el.brandMark) {
      if (c.logo_url) {
        el.brandMark.innerHTML = `<img src="${escapeHtml(c.logo_url)}" alt="Logo">`;
        el.brandMark.classList.add('has-img');
      } else {
        el.brandMark.textContent = (c.nombre_negocio || 'M').trim().charAt(0).toUpperCase();
        el.brandMark.classList.remove('has-img');
      }
    }

    if (el.heroTitulo) el.heroTitulo.textContent = c.hero_titulo || '';
    if (el.heroTexto) el.heroTexto.textContent = c.hero_texto || '';
    if (el.footerNombre) el.footerNombre.textContent = c.nombre_negocio || 'Mi Negocio';
    if (el.docTitle) el.docTitle.textContent = (c.nombre_negocio || 'Catálogo') + ' | Catálogo';
  }

  async function cargarCategorias() { state.categorias = await fetchJSON('/api/categorias'); }
  async function cargarProductos()  { state.productos  = await fetchJSON('/api/productos'); }

  /* ---------------- RENDER CATEGORÍAS ---------------- */
  function renderCategorias() {
    const items = [{ id: 'all', nombre: 'Todos' }];
    state.categorias.forEach((cat) => items.push({ id: cat.id, nombre: cat.nombre }));

    el.categoriesBar.innerHTML = items.map((it) => {
      const activa = String(state.categoriaActiva) === String(it.id);
      return `<button type="button" class="chip${activa ? ' is-active' : ''}"
                      data-cat="${escapeHtml(it.id)}">${escapeHtml(it.nombre)}</button>`;
    }).join('');
  }

  /* ---------------- RENDER PRODUCTOS ---------------- */
  function productosFiltrados() {
    const q = state.busqueda.trim().toLowerCase();
    const cat = state.categoriaActiva;
    return state.productos.filter((p) => {
      const coincideCat = cat === 'all' || String(p.categoria_id) === String(cat);
      if (!coincideCat) return false;
      if (!q) return true;
      return String(p.nombre || '').toLowerCase().includes(q) ||
             String(p.descripcion || '').toLowerCase().includes(q);
    });
  }

  function tarjetaHTML(p) {
    const imagen = p.imagen_url ? escapeHtml(p.imagen_url) : PLACEHOLDER_IMG;
    const cat = p.categoria_nombre ? escapeHtml(p.categoria_nombre) : 'General';
    const destacado = p.destacado ? '<span class="card__badge">Destacado</span>' : '';
    const desc = p.descripcion ? escapeHtml(p.descripcion) : '';
    return `
      <article class="card" data-id="${escapeHtml(p.id)}">
        <div class="card__media">
          <img src="${imagen}" alt="${escapeHtml(p.nombre)}" loading="lazy"
               onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
          ${destacado}
        </div>
        <div class="card__body">
          <span class="card__cat">${cat}</span>
          <h3 class="card__title">${escapeHtml(p.nombre)}</h3>
          <p class="card__desc">${desc}</p>
          <div class="card__prices">
            <span class="card__price-bs">${fmtBs(p.precio_bs)}</span>
            <span class="card__price-usd">${fmtUsd(p.precio_usd)}</span>
          </div>
          <button type="button" class="btn btn--primary btn--block"
                  data-add="${escapeHtml(p.id)}">+ Agregar</button>
        </div>
      </article>`;
  }

  function renderProductos() {
    const lista = productosFiltrados();
    el.catalogCount.textContent = lista.length === 1 ? '1 producto' : `${lista.length} productos`;

    const catNombre = state.categoriaActiva === 'all'
      ? 'Todos los productos'
      : (state.categorias.find((c) => String(c.id) === String(state.categoriaActiva))?.nombre || 'Productos');

    el.catalogTitle.textContent = state.busqueda.trim()
      ? `Resultados para "${state.busqueda.trim()}"`
      : catNombre;

    if (!lista.length) {
      el.grid.innerHTML = '';
      el.empty.hidden = false;
      return;
    }
    el.empty.hidden = true;
    el.grid.innerHTML = lista.map(tarjetaHTML).join('');
  }

  /* ---------------- CARRITO ---------------- */
  function totalCarrito() {
    return state.carrito.reduce((acc, it) => {
      acc.usd += it.precio_usd * it.cantidad;
      acc.bs += it.precio_bs * it.cantidad;
      return acc;
    }, { usd: 0, bs: 0 });
  }
  function totalUnidades() {
    return state.carrito.reduce((acc, it) => acc + it.cantidad, 0);
  }

  function agregarAlCarrito(productoId) {
    const prod = state.productos.find((p) => String(p.id) === String(productoId));
    if (!prod) return;
    const existente = state.carrito.find((it) => String(it.id) === String(prod.id));
    if (existente) existente.cantidad += 1;
    else state.carrito.push({
      id: Number(prod.id),
      nombre: prod.nombre,
      precio_usd: Number(prod.precio_usd) || 0,
      precio_bs: Number(prod.precio_bs) || 0,
      imagen_url: prod.imagen_url || null,
      cantidad: 1,
    });
    saveCart();
    renderCarrito();
    mostrarToast(
      `<strong>${escapeHtml(prod.nombre)}</strong> agregado al carrito.<br>Sigue agregando y cuando termines presiona el carrito 🛒`
    );
  }

  function cambiarCantidad(productoId, delta) {
    const item = state.carrito.find((it) => String(it.id) === String(productoId));
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) {
      state.carrito = state.carrito.filter((it) => String(it.id) !== String(productoId));
    }
    saveCart(); renderCarrito();
  }

  function eliminarDelCarrito(productoId) {
    state.carrito = state.carrito.filter((it) => String(it.id) !== String(productoId));
    saveCart(); renderCarrito();
  }

  function renderCarrito() {
    const unidades = totalUnidades();
    el.cartCount.textContent = String(unidades);
    el.cartCount.style.display = unidades > 0 ? 'grid' : 'none';

    if (!state.carrito.length) {
      el.cartItems.innerHTML = `
        <div class="cart-empty">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p>Tu carrito está vacío.</p>
        </div>`;
    } else {
      el.cartItems.innerHTML = state.carrito.map((it) => {
        const img = it.imagen_url ? escapeHtml(it.imagen_url) : PLACEHOLDER_IMG;
        return `
          <div class="cart-item" data-id="${escapeHtml(it.id)}">
            <img class="cart-item__img" src="${img}" alt="${escapeHtml(it.nombre)}"
                 onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
            <div class="cart-item__info">
              <p class="cart-item__name">${escapeHtml(it.nombre)}</p>
              <p class="cart-item__price">${fmtBs(it.precio_bs)} · ${fmtUsd(it.precio_usd)}</p>
              <div class="cart-item__qty">
                <button type="button" data-dec="${escapeHtml(it.id)}" aria-label="Disminuir">−</button>
                <span>${it.cantidad}</span>
                <button type="button" data-inc="${escapeHtml(it.id)}" aria-label="Aumentar">+</button>
              </div>
            </div>
            <button type="button" class="cart-item__remove" data-remove="${escapeHtml(it.id)}" aria-label="Eliminar">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>`;
      }).join('');
    }

    const t = totalCarrito();
    el.cartTotalBs.textContent = fmtBs(t.bs);
    el.cartTotalUsd.textContent = fmtUsd(t.usd);
  }

  /* ---------------- DRAWER CARRITO ---------------- */
  function abrirCarrito() {
    el.cartOverlay.hidden = false;
    requestAnimationFrame(() => {
      el.cartOverlay.classList.add('is-open');
      el.cartDrawer.classList.add('is-open');
      el.cartDrawer.setAttribute('aria-hidden', 'false');
    });
    document.body.style.overflow = 'hidden';
  }
  function cerrarCarrito() {
    el.cartOverlay.classList.remove('is-open');
    el.cartDrawer.classList.remove('is-open');
    el.cartDrawer.setAttribute('aria-hidden', 'true');
    if (!el.checkoutModal.classList.contains('is-open')) document.body.style.overflow = '';
    setTimeout(() => {
      if (!el.cartDrawer.classList.contains('is-open')) el.cartOverlay.hidden = true;
    }, 250);
  }

  /* ---------------- MODAL DE PEDIDO ---------------- */
  function renderModalPedido() {
    el.checkoutBody.innerHTML = state.carrito.map((it) => {
      const img = it.imagen_url ? escapeHtml(it.imagen_url) : PLACEHOLDER_IMG;
      const subtotalBs = it.precio_bs * it.cantidad;
      const subtotalUsd = it.precio_usd * it.cantidad;
      return `
        <div class="checkout-item">
          <img class="checkout-item__img" src="${img}" alt="${escapeHtml(it.nombre)}"
               onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
          <div class="checkout-item__info">
            <p class="checkout-item__name">${escapeHtml(it.nombre)}</p>
            <p class="checkout-item__meta">Cantidad: ${it.cantidad} · ${fmtUsd(it.precio_usd)} c/u</p>
          </div>
          <div class="checkout-item__price">
            ${fmtBs(subtotalBs)}
            <small>${fmtUsd(subtotalUsd)}</small>
          </div>
        </div>`;
    }).join('');

    const t = totalCarrito();
    el.checkoutCount.textContent = totalUnidades() === 1
      ? '1 unidad' : `${totalUnidades()} unidades`;
    el.checkoutTotalBs.textContent = fmtBs(t.bs);
    el.checkoutTotalUsd.textContent = fmtUsd(t.usd);
  }

  function abrirModalPedido() {
    if (!state.carrito.length) return;
    renderModalPedido();
    cerrarCarrito();

    el.checkoutOverlay.hidden = false;
    el.checkoutModal.hidden = false;

    requestAnimationFrame(() => {
      el.checkoutOverlay.classList.add('is-open');
      el.checkoutModal.classList.add('is-open');
    });
    document.body.style.overflow = 'hidden';
  }

  function cerrarModalPedido() {
    el.checkoutOverlay.classList.remove('is-open');
    el.checkoutModal.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!el.checkoutModal.classList.contains('is-open')) {
        el.checkoutOverlay.hidden = true;
        el.checkoutModal.hidden = true;
      }
    }, 280);
  }

  function enviarPedidoWhatsApp() {
    const numero = (state.config.whatsapp_number || WHATSAPP_FALLBACK || '').replace(/\D/g, '');

    const lineas = state.carrito.map((it) =>
      `• ${it.nombre} x${it.cantidad} — ${fmtBs(it.precio_bs * it.cantidad)} / ${fmtUsd(it.precio_usd * it.cantidad)}`
    ).join('\n');

    const t = totalCarrito();
    const mensaje =
      `Hola, quiero hacer el siguiente pedido:\n\n${lineas}\n\n` +
      `Total: ${fmtBs(t.bs)} / ${fmtUsd(t.usd)}`;

    if (numero) {
      const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
      window.open(url, '_blank', 'noopener');
      cerrarModalPedido();
    } else {
      alert('El número de WhatsApp no está configurado. Contacta al negocio.');
    }
  }

  /* ---------------- EVENTOS ---------------- */
  function bindEventos() {
    el.categoriesBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.categoriaActiva = btn.dataset.cat;
      renderCategorias(); renderProductos();
      window.scrollTo({ top: el.catalogTitle.offsetTop - 90, behavior: 'smooth' });
    });

    el.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn) return;
      agregarAlCarrito(btn.dataset.add);
    });

    el.search.addEventListener('input', debounce((e) => {
      state.busqueda = e.target.value || '';
      renderProductos();
    }, 180));

    el.cartButton.addEventListener('click', abrirCarrito);
    el.cartClose.addEventListener('click', cerrarCarrito);
    el.cartOverlay.addEventListener('click', cerrarCarrito);

    el.cartItems.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      const rem = e.target.closest('[data-remove]');
      if (inc) cambiarCantidad(inc.dataset.inc, +1);
      else if (dec) cambiarCantidad(dec.dataset.dec, -1);
      else if (rem) eliminarDelCarrito(rem.dataset.remove);
    });

    el.cartCheckout.addEventListener('click', abrirModalPedido);

    // Modal de pedido
    el.checkoutClose.addEventListener('click', cerrarModalPedido);
    el.checkoutCancel.addEventListener('click', cerrarModalPedido);
    el.checkoutOverlay.addEventListener('click', cerrarModalPedido);
    el.checkoutConfirm.addEventListener('click', enviarPedidoWhatsApp);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (el.checkoutModal.classList.contains('is-open')) cerrarModalPedido();
      else if (el.cartDrawer.classList.contains('is-open')) cerrarCarrito();
    });
  }

  /* ---------------- INIT ---------------- */
  async function init() {
    el.year.textContent = new Date().getFullYear();
    state.carrito = loadCart();
    renderCarrito();
    bindEventos();

    el.loading.hidden = false;
    el.empty.hidden = true;

    try {
      await Promise.all([cargarConfig(), cargarCategorias(), cargarProductos()]);
      aplicarConfig();
      renderCategorias();
      renderProductos();
    } catch (err) {
      console.error(err);
      el.grid.innerHTML = `
        <div class="state state--empty" style="grid-column:1/-1">
          <p><strong>No se pudo conectar con la API.</strong></p>
          <p style="font-size:.85rem">Verifica <code>config.js</code>:<br>
            <code>${escapeHtml(API_URL)}</code></p>
        </div>`;
    } finally {
      el.loading.hidden = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
