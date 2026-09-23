/* =========================================================
   CATÁLOGO — Lógica del frontend
   ========================================================= */
(function () {
  'use strict';

  const CONFIG  = window.CATALOGO_CONFIG || {};
  const API_URL = String(CONFIG.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const WHATSAPP_FALLBACK = String(CONFIG.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const STORAGE_KEY = 'catalogo_carrito_v1';
  const DESCRIPCION_UMBRAL = 90; // si la descripción supera esta longitud, aparece "Leer más"

  const state = {
    productos: [],
    categorias: [],
    categoriaActiva: 'all',
    busqueda: '',
    carrito: [],
    productoDescActual: null, // producto abierto en el modal de descripción
    config: {
      nombre_negocio: 'Mi Negocio',
      hero_titulo: 'Todo lo que necesitas, en un solo lugar',
      hero_texto: 'Explora nuestro catálogo con productos seleccionados, precios actualizados y envíos a todo el país.',
      logo_url: '',
      whatsapp_number: '',
      color_primario: '#2563eb',
      color_oscuro: '#1e3a8a',
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
    themeMeta:     document.querySelector('meta[name="theme-color"]'),

    checkoutOverlay: document.getElementById('checkoutOverlay'),
    checkoutModal:   document.getElementById('checkoutModal'),
    checkoutBody:    document.getElementById('checkoutBody'),
    checkoutClose:   document.getElementById('checkoutClose'),
    checkoutCancel:  document.getElementById('checkoutCancel'),
    checkoutConfirm: document.getElementById('checkoutConfirm'),
    checkoutCount:   document.getElementById('checkoutCount'),
    checkoutTotalBs: document.getElementById('checkoutTotalBs'),
    checkoutTotalUsd:document.getElementById('checkoutTotalUsd'),

    descOverlay:  document.getElementById('descOverlay'),
    descModal:    document.getElementById('descModal'),
    descClose:    document.getElementById('descClose'),
    descTitle:    document.getElementById('descTitle'),
    descCat:      document.getElementById('descCat'),
    descImg:      document.getElementById('descImg'),
    descPriceBs:  document.getElementById('descPriceBs'),
    descPriceUsd: document.getElementById('descPriceUsd'),
    descText:     document.getElementById('descText'),
    descQtyDec:   document.getElementById('descQtyDec'),
    descQtyInc:   document.getElementById('descQtyInc'),
    descQtyInput: document.getElementById('descQtyInput'),
    descAdd:      document.getElementById('descAdd'),

    imageZoom:      document.getElementById('imageZoom'),
    imageZoomImg:   document.getElementById('imageZoomImg'),
    imageZoomClose: document.getElementById('imageZoomClose'),
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
  function mixColor(hex, target, ratio) {
    const parse = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    try {
      const [r, g, b] = parse(hex);
      const [tr, tg, tb] = parse(target);
      const nr = Math.round(r + (tr - r) * ratio);
      const ng = Math.round(g + (tg - g) * ratio);
      const nb = Math.round(b + (tb - b) * ratio);
      return '#' + [nr, ng, nb].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch { return hex; }
  }
  function clampQty(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    if (n > 999) return 999;
    return n;
  }

  /* ---------------- PLACEHOLDER ---------------- */
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
        <g stroke-linejoin="round" stroke-linecap="round">
          <path d="M 200 92 L 268 128 L 268 196 L 200 232 L 132 196 L 132 128 Z"
                fill="#dbeafe" stroke="#94a3b8" stroke-width="3"/>
          <path d="M 132 128 L 200 164 L 268 128"
                fill="#eff6ff" stroke="#94a3b8" stroke-width="3"/>
          <path d="M 200 164 L 200 232"
                stroke="#94a3b8" stroke-width="3" stroke-opacity="0.55"/>
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

  function aplicarColores() {
    const c = state.config;
    const primario = c.color_primario || '#2563eb';
    const oscuro = c.color_oscuro || '#1e3a8a';
    const root = document.documentElement.style;

    root.setProperty('--blue-500', primario);
    root.setProperty('--blue-600', primario);
    root.setProperty('--blue-700', mixColor(primario, '#000000', 0.15));
    root.setProperty('--blue-900', oscuro);
    root.setProperty('--blue-200', mixColor(primario, '#ffffff', 0.72));
    root.setProperty('--blue-100', mixColor(primario, '#ffffff', 0.86));
    root.setProperty('--blue-50',  mixColor(primario, '#ffffff', 0.94));

    if (el.themeMeta) el.themeMeta.setAttribute('content', oscuro);
  }

  function aplicarConfig() {
    const c = state.config;
    if (el.brandName) el.brandName.textContent = c.nombre_negocio || 'Mi Negocio';

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

    aplicarColores();
  }

  async function cargarCategorias() { state.categorias = await fetchJSON('/api/categorias'); }
  async function cargarProductos()  { state.productos  = await fetchJSON('/api/productos'); }

  /* ---------------- CATEGORÍAS ---------------- */
  function renderCategorias() {
    const items = [{ id: 'all', nombre: 'Todos' }];
    state.categorias.forEach((cat) => items.push({ id: cat.id, nombre: cat.nombre }));
    el.categoriesBar.innerHTML = items.map((it) => {
      const activa = String(state.categoriaActiva) === String(it.id);
      return `<button type="button" class="chip${activa ? ' is-active' : ''}"
                      data-cat="${escapeHtml(it.id)}">${escapeHtml(it.nombre)}</button>`;
    }).join('');
  }

  /* ---------------- PRODUCTOS ---------------- */
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
    const descLarga = (p.descripcion || '').length > DESCRIPCION_UMBRAL;
    const tieneImagen = !!p.imagen_url;

    return `
      <article class="card" data-id="${escapeHtml(p.id)}">
        <div class="card__media"${tieneImagen ? ' data-zoom="1"' : ''}>
          <img src="${imagen}" alt="${escapeHtml(p.nombre)}" loading="lazy"
               onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" />
          ${destacado}
        </div>
        <div class="card__body">
          <span class="card__cat">${cat}</span>
          <h3 class="card__title">${escapeHtml(p.nombre)}</h3>
          <div class="card__desc">
            <span class="card__desc-text">${desc}</span>
            ${descLarga ? `<button type="button" class="card__readmore" data-readmore="${escapeHtml(p.id)}">Leer más</button>` : ''}
          </div>
          <div class="card__prices">
            <span class="card__price-bs">${fmtBs(p.precio_bs)}</span>
            <span class="card__price-usd">${fmtUsd(p.precio_usd)}</span>
          </div>
          <div class="card__add">
            <div class="qty-control">
              <button type="button" data-card-dec="${escapeHtml(p.id)}" aria-label="Disminuir">−</button>
              <input type="number" data-card-qty="${escapeHtml(p.id)}" value="1" min="1" max="999" inputmode="numeric" aria-label="Cantidad" />
              <button type="button" data-card-inc="${escapeHtml(p.id)}" aria-label="Aumentar">+</button>
            </div>
            <button type="button" class="btn btn--primary" data-add="${escapeHtml(p.id)}">Agregar</button>
          </div>
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

  function agregarAlCarrito(productoId, cantidad) {
    const cant = clampQty(cantidad);
    const prod = state.productos.find((p) => String(p.id) === String(productoId));
    if (!prod) return;
    const existente = state.carrito.find((it) => String(it.id) === String(prod.id));
    if (existente) {
      existente.cantidad += cant;
    } else {
      state.carrito.push({
        id: Number(prod.id),
        nombre: prod.nombre,
        precio_usd: Number(prod.precio_usd) || 0,
        precio_bs: Number(prod.precio_bs) || 0,
        imagen_url: prod.imagen_url || null,
        cantidad: cant,
      });
    }
    saveCart();
    renderCarrito();
    const etiqueta = cant === 1
      ? `<strong>${escapeHtml(prod.nombre)}</strong> agregado al carrito.`
      : `<strong>${cant}× ${escapeHtml(prod.nombre)}</strong> agregados al carrito.`;
    mostrarToast(`${etiqueta}<br>Cuando termines presiona el carrito 🛒`);
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

  /* ---------------- DRAWER ---------------- */
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
    if (!el.checkoutModal.classList.contains('is-open') && !el.descModal.classList.contains('is-open')) {
      document.body.style.overflow = '';
    }
    setTimeout(() => {
      if (!el.cartDrawer.classList.contains('is-open')) el.cartOverlay.hidden = true;
    }, 250);
  }

  /* ---------------- MODAL PEDIDO ---------------- */
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
    const mensaje = `Hola, quiero hacer el siguiente pedido:\n\n${lineas}\n\nTotal: ${fmtBs(t.bs)} / ${fmtUsd(t.usd)}`;
    if (numero) {
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener');
      cerrarModalPedido();
    } else {
      alert('El número de WhatsApp no está configurado. Contacta al negocio.');
    }
  }

  /* ---------------- MODAL DE DESCRIPCIÓN ---------------- */
  function abrirDescModal(productoId) {
    const p = state.productos.find((x) => String(x.id) === String(productoId));
    if (!p) return;

    state.productoDescActual = p;
    el.descTitle.textContent = p.nombre || 'Producto';
    el.descCat.textContent = p.categoria_nombre || 'General';
    el.descImg.src = p.imagen_url || PLACEHOLDER_IMG;
    el.descImg.alt = p.nombre || '';
    el.descPriceBs.textContent = fmtBs(p.precio_bs);
    el.descPriceUsd.textContent = fmtUsd(p.precio_usd);
    el.descText.textContent = p.descripcion || 'Sin descripción.';
    el.descQtyInput.value = '1';

    el.descOverlay.hidden = false;
    el.descModal.hidden = false;
    requestAnimationFrame(() => {
      el.descOverlay.classList.add('is-open');
      el.descModal.classList.add('is-open');
    });
    document.body.style.overflow = 'hidden';
  }

  function cerrarDescModal() {
    el.descOverlay.classList.remove('is-open');
    el.descModal.classList.remove('is-open');
    document.body.style.overflow = '';
    state.productoDescActual = null;
    setTimeout(() => {
      if (!el.descModal.classList.contains('is-open')) {
        el.descOverlay.hidden = true;
        el.descModal.hidden = true;
      }
    }, 280);
  }

  /* ---------------- ZOOM DE IMAGEN ---------------- */
  function abrirZoom(src) {
    if (!el.imageZoom || !el.imageZoomImg) return;
    el.imageZoomImg.src = src;
    el.imageZoom.hidden = false;
    requestAnimationFrame(() => el.imageZoom.classList.add('is-open'));
    document.body.style.overflow = 'hidden';
  }
  function cerrarZoom() {
    if (!el.imageZoom) return;
    el.imageZoom.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!el.imageZoom.classList.contains('is-open')) {
        el.imageZoom.hidden = true;
        el.imageZoomImg.src = '';
      }
    }, 300);
  }

  /* ---------------- HELPERS DE CANTIDAD EN TARJETA ---------------- */
  function getCardQty(id) {
    const input = document.querySelector(`[data-card-qty="${CSS.escape(String(id))}"]`);
    return input ? clampQty(input.value) : 1;
  }
  function setCardQty(id, value) {
    const input = document.querySelector(`[data-card-qty="${CSS.escape(String(id))}"]`);
    if (input) input.value = String(clampQty(value));
  }

  /* ---------------- EVENTOS ---------------- */
  function bindEventos() {
    // Categorías
    el.categoriesBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.categoriaActiva = btn.dataset.cat;
      renderCategorias(); renderProductos();
      window.scrollTo({ top: el.catalogTitle.offsetTop - 90, behavior: 'smooth' });
    });

    // Delegación en el grid
    el.grid.addEventListener('click', (e) => {
      const addBtn   = e.target.closest('[data-add]');
      const incBtn   = e.target.closest('[data-card-inc]');
      const decBtn   = e.target.closest('[data-card-dec]');
      const moreBtn  = e.target.closest('[data-readmore]');

      if (addBtn) {
        const id = addBtn.dataset.add;
        agregarAlCarrito(id, getCardQty(id));
        setCardQty(id, 1); // resetear el input tras agregar
        return;
      }
      if (incBtn) {
        const id = incBtn.dataset.cardInc;
        setCardQty(id, getCardQty(id) + 1);
        return;
      }
      if (decBtn) {
        const id = decBtn.dataset.cardDec;
        setCardQty(id, getCardQty(id) - 1);
        return;
      }
      if (moreBtn) {
        abrirDescModal(moreBtn.dataset.readmore);
        return;
      }

      // Zoom de imagen
      const media = e.target.closest('.card__media[data-zoom]');
      if (media) {
        const img = media.querySelector('img');
        if (img && img.src && !img.src.startsWith('data:')) abrirZoom(img.src);
      }
    });

    // Cambio manual en los inputs de cantidad de las tarjetas
    el.grid.addEventListener('change', (e) => {
      const input = e.target.closest('[data-card-qty]');
      if (!input) return;
      input.value = String(clampQty(input.value));
    });

    // Buscador
    el.search.addEventListener('input', debounce((e) => {
      state.busqueda = e.target.value || '';
      renderProductos();
    }, 180));

    // Carrito
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
    el.checkoutClose.addEventListener('click', cerrarModalPedido);
    el.checkoutCancel.addEventListener('click', cerrarModalPedido);
    el.checkoutOverlay.addEventListener('click', cerrarModalPedido);
    el.checkoutConfirm.addEventListener('click', enviarPedidoWhatsApp);

    // Modal de descripción
    el.descClose.addEventListener('click', cerrarDescModal);
    el.descOverlay.addEventListener('click', cerrarDescModal);
    el.descQtyInc.addEventListener('click', () => {
      el.descQtyInput.value = String(clampQty(parseInt(el.descQtyInput.value, 10) + 1));
    });
    el.descQtyDec.addEventListener('click', () => {
      el.descQtyInput.value = String(clampQty(parseInt(el.descQtyInput.value, 10) - 1));
    });
    el.descQtyInput.addEventListener('change', () => {
      el.descQtyInput.value = String(clampQty(el.descQtyInput.value));
    });
    el.descAdd.addEventListener('click', () => {
      if (!state.productoDescActual) return;
      agregarAlCarrito(state.productoDescActual.id, el.descQtyInput.value);
      cerrarDescModal();
    });

    // Zoom
    if (el.imageZoomClose) el.imageZoomClose.addEventListener('click', (e) => { e.stopPropagation(); cerrarZoom(); });
    if (el.imageZoom) el.imageZoom.addEventListener('click', cerrarZoom);

    // Escape cierra lo que esté abierto (en orden)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (el.imageZoom && el.imageZoom.classList.contains('is-open')) cerrarZoom();
      else if (el.descModal.classList.contains('is-open')) cerrarDescModal();
      else if (el.checkoutModal.classList.contains('is-open')) cerrarModalPedido();
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
