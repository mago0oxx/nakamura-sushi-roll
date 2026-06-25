/**
 * api-integration.js — Nakamura Sushi Roll
 * Conecta el frontend con el backend Node.js:
 * - Envía pedidos a la API REST
 * - Abre MercadoPago Checkout Pro
 * - Persiste pedidos en la base de datos
 */
(function() {
  'use strict';

  // ── Configuración ──────────────────────────────────────────────────────
  const API_BASE = '';  // mismo origen que el servidor

  // Cargar menú desde el backend: sincronizar imágenes e inyectar ítems nuevos
  fetch(API_BASE + '/api/menu')
    .then(r => r.json())
    .then(data => {
      if (!data.items || typeof window.MENU === 'undefined') return;

      const localIds = new Set(Object.values(window.MENU).flat().map(i => i.id));

      data.items.forEach(serverItem => {
        // Sincronizar imagen en ítems existentes
        if (localIds.has(serverItem.id)) {
          Object.values(window.MENU).forEach(cat => {
            cat.forEach(item => {
              if (item.id === serverItem.id && serverItem.image) item.image = serverItem.image;
            });
          });
        } else {
          // Ítem nuevo creado desde el admin — inyectarlo en el MENU
          const cat = serverItem.category;
          if (!window.MENU[cat]) window.MENU[cat] = [];
          window.MENU[cat].push({
            id: serverItem.id,
            n: serverItem.name,
            d: serverItem.description || '',
            p: serverItem.price,
            pz: serverItem.pieces || '',
            tags: serverItem.tags || [],
            image: serverItem.image || '',
          });
        }
      });

      if (typeof window.renderGrid === 'function') window.renderGrid();
      if (typeof window.renderTabs === 'function') window.renderTabs();
    })
    .catch(() => {});

  // Cargar settings desde el backend
  let serverSettings = {};
  fetch(API_BASE + '/api/settings')
    .then(r => r.json())
    .then(s => {
      serverSettings = s;
      // Actualizar ENVIO_GRATIS_DESDE si está definido en el frontend
      if (typeof window.ENVIO_GRATIS_DESDE !== 'undefined' && s.free_shipping_threshold) {
        window.ENVIO_GRATIS_DESDE = Number(s.free_shipping_threshold);
      }
      if (typeof window.ENVIO_COSTO !== 'undefined' && s.shipping_cost) {
        window.ENVIO_COSTO = Number(s.shipping_cost);
      }
    })
    .catch(() => {});

  // ── Helper: construir array de items del carrito ───────────────────────
  function buildItemsArray() {
    const items = [];
    // cart es el objeto global del frontend original
    if (typeof window.cart === 'undefined') return items;

    for (const [id, qty] of Object.entries(window.cart)) {
      const item = typeof window.findItem === 'function' ? window.findItem(id) : null;
      if (!item) continue;

      const lineItem = {
        id,
        name: item.n || item.name || id,
        qty: typeof qty === 'object' ? qty.qty || 1 : qty,
        price: item.p || item.price || 0,
        pieces: item.pz || item.pieces || '',
        detail: item.detail || '',
      };
      items.push(lineItem);
    }
    return items;
  }

  // ── Override de confirmarPedido ────────────────────────────────────────
  // Reemplaza la función original para persistir en el backend
  window.confirmarPedido = async function() {
    const btn = document.querySelector('#modalBox .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }

    try {
      // Calcular totales
      const totFn = typeof window.totals === 'function' ? window.totals() : { sub: 0, env: 0, tot: 0 };
      const { sub, env, tot } = totFn;

      const items = buildItemsArray();
      if (!items.length) {
        if (typeof window.showToast === 'function') window.showToast('El carrito está vacío');
        return;
      }

      // Datos del cliente
      const cliente = window.datosCliente || {};
      const address = [cliente.dir, cliente.timbre].filter(Boolean).join(' — ');

      const metodoPago = window.metodoPago || 'Efectivo';

      // POST al backend
      const resp = await fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cliente.nombre,
          phone: cliente.tel,
          address: address,
          notes: cliente.notas || '',
          items,
          subtotal: sub,
          shipping: env,
          total: tot,
          payment: metodoPago.toLowerCase().replace(/\s+/g, '_'),
        }),
      });

      if (!resp.ok) throw new Error('Error al guardar el pedido');
      const data = await resp.json();
      const orderId = data.id;

      // Guardar ID en variable global para usarla en WhatsApp y confirmación
      window.ordenActual = orderId;

      // ── MercadoPago: abrir checkout ──
      if (metodoPago.toLowerCase().includes('mercadopago')) {
        try {
          const mpResp = await fetch(API_BASE + `/api/orders/${orderId}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const mpData = await mpResp.json();

          if (mpData.error) {
            // MP no configurado → seguir con flujo normal + WhatsApp
            console.warn('MercadoPago:', mpData.error);
            window.pasoCheckout = 3;
            if (typeof window.renderModal === 'function') window.renderModal();
            return;
          }

          // Redirigir al checkout de MP
          const mpUrl = mpData.sandbox_init_point || mpData.init_point;
          window.location.href = mpUrl;
          return;
        } catch (mpErr) {
          console.warn('Error MP, continuando con flujo normal:', mpErr);
        }
      }

      // ── Flujo normal (efectivo / tarjeta al recibir) ──
      window.pasoCheckout = 3;
      if (typeof window.renderModal === 'function') window.renderModal();

    } catch (err) {
      console.error('Error al confirmar pedido:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Error al procesar el pedido. Intenta de nuevo.');
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }
    }
  };

  // ── Override de renderModal: actualizar opciones de pago ──────────────
  // Espera a que el DOM y el JS original estén listos
  window.addEventListener('load', function() {
    const originalRenderModal = window.renderModal;
    if (typeof originalRenderModal !== 'function') return;

    window.renderModal = function() {
      originalRenderModal.apply(this, arguments);

      // En el paso 2, actualizar el texto de MercadoPago para indicar que es online
      if (window.pasoCheckout === 2) {
        setTimeout(() => {
          const ops = document.querySelectorAll('.pago-op');
          ops.forEach(op => {
            const title = op.querySelector('.ptitle');
            const desc = op.querySelector('.pdesc');
            if (title && title.textContent.trim() === 'MercadoPago') {
              if (desc) desc.textContent = 'Pago online con tarjeta, débito o dinero en cuenta';
            }
          });
        }, 50);
      }

      // En el paso 3, mostrar badge "Guardado" junto al número de orden
      if (window.pasoCheckout === 3) {
        setTimeout(() => {
          const ordenEl = document.querySelector('.confirm .orden');
          if (ordenEl && !ordenEl.querySelector('.guardado-badge')) {
            const badge = document.createElement('span');
            badge.className = 'guardado-badge';
            badge.style.cssText = 'display:inline-block;margin-left:10px;font-size:10px;background:rgba(31,168,85,.2);color:#5cd98a;border:1px solid rgba(31,168,85,.4);padding:2px 8px;border-radius:99px;font-family:var(--body);letter-spacing:.05em';
            badge.textContent = '✓ Guardado';
            ordenEl.appendChild(badge);
          }
        }, 100);
      }
    };
  });

  console.log('✅ Nakamura API Integration cargada');
})();
