// server.js — Nakamura Sushi Roll
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const fs     = require('fs');
const multer = require('multer');
const {
  db,
  getOrders, getOrder, createOrder, updateOrderStatus, updateOrderPayment,
  getMenuItems, updateMenuItem, updateMenuItemImage, createMenuItem, deleteMenuItem,
  getSetting, getAllSettings, updateSetting,
} = require('./database');

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `menu-${req.params.id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware admin ──────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const [, encoded] = auth.split(' ');
  if (!encoded) return res.status(401).json({ error: 'No autorizado' });
  const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next();
  }
  res.status(401).json({ error: 'Credenciales inválidas' });
}

// ══════════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════════════════════════

// ── Menú ──────────────────────────────────────────────────────────────────
app.get('/api/menu', (req, res) => {
  try {
    const items = getMenuItems(true);
    // Parsear tags JSON
    const parsed = items.map(i => ({ ...i, tags: JSON.parse(i.tags || '[]') }));
    // Agrupar por categoría
    const grouped = parsed.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});
    res.json({ menu: grouped, items: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Settings públicas (nombre, mínimo, envío) ─────────────────────────────
app.get('/api/settings', (req, res) => {
  try {
    const s = getAllSettings();
    // Solo exponer los campos no sensibles
    res.json({
      restaurant_name: s.restaurant_name,
      free_shipping_threshold: Number(s.free_shipping_threshold),
      shipping_cost: Number(s.shipping_cost),
      min_order: Number(s.min_order),
      estimated_delivery: s.estimated_delivery,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Crear pedido ───────────────────────────────────────────────────────────
app.post('/api/orders', (req, res) => {
  try {
    const { name, phone, address, notes = '', items, subtotal, shipping, total, payment } = req.body;

    if (!name || !phone || !address || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const id = 'NKM-' + uuidv4().split('-')[0].toUpperCase();

    createOrder.run({
      id,
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      notes: notes.trim(),
      items: JSON.stringify(items),
      subtotal: Number(subtotal),
      shipping: Number(shipping),
      total: Number(total),
      payment: payment || 'efectivo',
    });

    res.status(201).json({ id, message: 'Pedido creado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Estado de un pedido ───────────────────────────────────────────────────
app.get('/api/orders/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ ...order, items: JSON.parse(order.items) });
});

// ══════════════════════════════════════════════════════════════════════════════
// MERCADOPAGO
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/orders/:id/checkout', async (req, res) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken || accessToken.startsWith('TEST-xxx')) {
      return res.status(400).json({
        error: 'MercadoPago no configurado. Agrega tu MP_ACCESS_TOKEN en el archivo .env'
      });
    }

    const { MercadoPagoConfig, Preference } = require('mercadopago');
    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    const items = JSON.parse(order.items);
    const mpItems = items.map(item => ({
      id: item.id || 'item',
      title: item.name,
      quantity: item.qty,
      unit_price: Number(item.price),
      currency_id: 'ARS',
    }));

    // Añadir envío si aplica
    if (Number(order.shipping) > 0) {
      mpItems.push({
        id: 'shipping',
        title: 'Envío a domicilio',
        quantity: 1,
        unit_price: Number(order.shipping),
        currency_id: 'ARS',
      });
    }

    const base = process.env.BASE_URL || `http://localhost:${PORT}`;

    const prefData = await preference.create({
      body: {
        items: mpItems,
        payer: { name: order.name, phone: { number: order.phone } },
        external_reference: order.id,
        back_urls: {
          success: `${base}/pago-exitoso.html?order=${order.id}`,
          failure: `${base}/pago-fallido.html?order=${order.id}`,
          pending: `${base}/pago-pendiente.html?order=${order.id}`,
        },
        auto_return: 'approved',
        notification_url: `${base}/api/mp-webhook`,
        metadata: { order_id: order.id },
      }
    });

    updateOrderPayment.run(prefData.id, '', 'pendiente', order.id);

    res.json({
      init_point: prefData.init_point,
      sandbox_init_point: prefData.sandbox_init_point,
      preference_id: prefData.id,
    });
  } catch (e) {
    console.error('MP Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Webhook de MercadoPago ────────────────────────────────────────────────
app.post('/api/mp-webhook', (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id) {
      // Aquí podrías consultar el pago vía API de MP y actualizar el estado
      console.log('MP webhook - payment id:', data.id);
    }
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(200); // MP requiere 200 aunque haya error interno
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// API ADMIN (requiere autenticación)
// ══════════════════════════════════════════════════════════════════════════════

// Login check
app.post('/api/admin/login', adminAuth, (req, res) => {
  res.json({ ok: true, user: process.env.ADMIN_USER });
});

// Todos los pedidos
app.get('/api/admin/orders', adminAuth, (req, res) => {
  try {
    const orders = getOrders(500).map(o => ({
      ...o,
      items: JSON.parse(o.items),
    }));
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de un pedido
app.patch('/api/admin/orders/:id/status', adminAuth, (req, res) => {
  const { status } = req.body;
  const valid = ['pendiente','pagado','preparando','listo','entregado','cancelado'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  updateOrderStatus.run(status, req.params.id);
  res.json({ ok: true });
});

// Menú completo (con inactivos)
app.get('/api/admin/menu', adminAuth, (req, res) => {
  try {
    const items = getMenuItems(false).map(i => ({ ...i, tags: JSON.parse(i.tags || '[]') }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear ítem del menú
app.post('/api/admin/menu', adminAuth, (req, res) => {
  try {
    const { category, name, description, price, pieces, tags } = req.body;
    if (!category || !name || !price) return res.status(400).json({ error: 'Faltan datos obligatorios' });
    const id = 'item-' + uuidv4().split('-')[0];
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM menu_items WHERE category=?').get(category).m;
    createMenuItem.run({
      id, category, name: name.trim(),
      description: (description || '').trim(),
      price: Number(price),
      pieces: (pieces || '').trim(),
      tags: JSON.stringify(tags || []),
      sort_order: maxOrder + 1,
    });
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar ítem del menú
app.delete('/api/admin/menu/:id', adminAuth, (req, res) => {
  try {
    deleteMenuItem.run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Editar item del menú
app.patch('/api/admin/menu/:id', adminAuth, (req, res) => {
  try {
    const { name, description, price, pieces, tags, active } = req.body;
    updateMenuItem.run({
      id: req.params.id,
      name, description,
      price: Number(price),
      pieces: pieces || '',
      tags: JSON.stringify(tags || []),
      active: active ? 1 : 0,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Subir imagen de ítem del menú
app.post('/api/admin/menu/:id/image', adminAuth, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const imageUrl = `/uploads/${req.file.filename}`;
    updateMenuItemImage.run(imageUrl, req.params.id);
    res.json({ ok: true, image: imageUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar imagen de ítem del menú
app.delete('/api/admin/menu/:id/image', adminAuth, (req, res) => {
  try {
    const items = getMenuItems(false);
    const item = items.find(i => i.id === req.params.id);
    if (item?.image) {
      const filePath = path.join(__dirname, 'public', item.image);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    updateMenuItemImage.run('', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Settings admin
app.get('/api/admin/settings', adminAuth, (req, res) => {
  try {
    res.json(getAllSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/settings', adminAuth, (req, res) => {
  try {
    const allowed = ['restaurant_name','whatsapp','free_shipping_threshold',
                     'shipping_cost','min_order','estimated_delivery'];
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) updateSetting.run(k, String(v));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estadísticas
app.get('/api/admin/stats', adminAuth, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status NOT IN ('cancelado') THEN total ELSE 0 END),0) as revenue,
        COALESCE(AVG(CASE WHEN status NOT IN ('cancelado') THEN total ELSE NULL END),0) as avg_ticket,
        COUNT(CASE WHEN status='pendiente' THEN 1 END) as pending,
        COUNT(CASE WHEN status='preparando' THEN 1 END) as preparing,
        COUNT(CASE WHEN status='pagado' THEN 1 END) as paid,
        COUNT(CASE WHEN date(created_at)=date('now','localtime') THEN 1 END) as today
      FROM orders
    `).get();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Páginas de resultado de pago ──────────────────────────────────────────
app.get('/pago-exitoso.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pago-resultado.html'));
});
app.get('/pago-fallido.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pago-resultado.html'));
});
app.get('/pago-pendiente.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pago-resultado.html'));
});

// ── Fallback SPA ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Arrancar ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🍣  Nakamura Sushi Roll corriendo en http://localhost:${PORT}`);
  console.log(`📊  Panel admin: http://localhost:${PORT}/admin`);
  console.log(`\n    Usuario: ${process.env.ADMIN_USER || 'admin'}`);
  console.log(`    Clave:   ${process.env.ADMIN_PASS || 'nakamura2025'}\n`);
});
