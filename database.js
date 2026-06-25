// database.js — SQLite con better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'nakamura.db'));

// WAL para mayor rendimiento
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migración: agregar columna image si no existe
try { db.exec(`ALTER TABLE menu_items ADD COLUMN image TEXT DEFAULT ''`); } catch(e) {}

// ── Esquema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id          TEXT PRIMARY KEY,
    created_at  DATETIME DEFAULT (datetime('now','localtime')),
    status      TEXT DEFAULT 'pendiente',   -- pendiente | pagado | preparando | listo | entregado | cancelado
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    address     TEXT NOT NULL,
    notes       TEXT DEFAULT '',
    items       TEXT NOT NULL,              -- JSON array de líneas de pedido
    subtotal    REAL NOT NULL,
    shipping    REAL NOT NULL DEFAULT 0,
    total       REAL NOT NULL,
    payment     TEXT DEFAULT 'efectivo',    -- efectivo | mercadopago | transferencia
    mp_pref_id  TEXT DEFAULT '',            -- Preference ID de MercadoPago
    mp_payment_id TEXT DEFAULT ''           -- Payment ID de MercadoPago
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    price       REAL NOT NULL,
    pieces      TEXT DEFAULT '',
    tags        TEXT DEFAULT '[]',          -- JSON array
    active      INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    image       TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );
`);

// ── Valores por defecto de configuración ──────────────────────────────────

const defaultSettings = {
  restaurant_name: 'Nakamura Sushi Roll',
  whatsapp: '5491112345678',
  free_shipping_threshold: '4500',
  shipping_cost: '600',
  min_order: '1500',
  estimated_delivery: '45-60 min',
};

const upsertSetting = db.prepare(
  `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`
);
for (const [k, v] of Object.entries(defaultSettings)) {
  upsertSetting.run(k, v);
}

// ── Menú inicial (solo si la tabla está vacía) ─────────────────────────────

const menuCount = db.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;

if (menuCount === 0) {
  const insertItem = db.prepare(`
    INSERT INTO menu_items(id, category, name, description, price, pieces, tags, sort_order)
    VALUES(@id, @category, @name, @description, @price, @pieces, @tags, @sort_order)
  `);

  const seedItems = [
    // Rolls
    { id:'r1',  category:'Rolls',     name:'California Roll',    description:'Kanikama, palta y pepino, envuelto en sésamo. Fresco y liviano, el favorito de siempre.',                                                                   price:6500,  pieces:'10-50 pzs', tags:'["⭐ Clásico"]',                    sort_order:1 },
    { id:'r2',  category:'Rolls',     name:'Philadelphia Roll',  description:'Salmón ahumado, queso crema suave y palta cremosa, envuelto en salmón. El clásico que nunca falla.',                                                         price:7500,  pieces:'10-50 pzs', tags:'["⭐ Más pedido"]',                  sort_order:2 },
    { id:'r3',  category:'Rolls',     name:'Tiger Roll',         description:'Salmón, queso crema y palta, empanado en panko y frito, bañado en salsa unagi. Crocante por fuera, cremoso por dentro.',                                    price:8500,  pieces:'10-50 pzs', tags:'["⭐ Recomendado","🔥 Frito"]',     sort_order:3 },
    { id:'r4',  category:'Rolls',     name:'Mango Masu Roll',    description:'Relleno de salmón, queso crema y palta, con salsa de maracuyá. Dulce y tropical, la firma de la casa.',                                                     price:8500,  pieces:'10-50 pzs', tags:'["🥭 Frutal"]',                     sort_order:4 },
    { id:'r5',  category:'Rolls',     name:'Plátano Roll',       description:'Plátano maduro y queso crema. Dulce, distinto y adictivo.',                                                                                                   price:7000,  pieces:'10-50 pzs', tags:'["🌴 Fusión"]',                     sort_order:5 },
    { id:'r6',  category:'Rolls',     name:'Ebi Spicy Roll',     description:'Langostino, queso crema y palta con spicy mayo. Cremoso con el picante justo.',                                                                              price:8000,  pieces:'10-50 pzs', tags:'["🦐 Langostino","🌶️ Picante"]',   sort_order:6 },
    // Pokes
    { id:'pk1', category:'Pokes',     name:'Poke de Salmón',     description:'Salmón fresco, arroz de sushi, aguacate, pepino, edamame, cebolla morada, zanahoria, sésamo y salsa especial Nakamura.',                                    price:14500, pieces:'Bowl',      tags:'["⭐ Recomendado"]',                sort_order:1 },
    { id:'pk2', category:'Pokes',     name:'Poke de Atún',       description:'Atún fresco marinado en salsa especial Nakamura, sobre arroz con aguacate, pepino, edamame, cebolla morada, algas wakame y ajonjolí.',                      price:15000, pieces:'Bowl',      tags:'["⭐ Recomendado"]',                sort_order:2 },
    { id:'pk4', category:'Pokes',     name:'Poke de Pollo',      description:'Pollo jugoso a la plancha o teriyaki, sobre arroz con aguacate, pepino, edamame, algas wakame, cebolla morada y salsa especial Nakamura.',                  price:13000, pieces:'Bowl',      tags:'[]',                                sort_order:3 },
    { id:'pk5', category:'Pokes',     name:'Poke Mixto',         description:'La combinación perfecta de salmón, atún y langostino sobre arroz, con aguacate, pepino, edamame, algas wakame, cebolla morada y salsa especial Nakamura.',  price:16500, pieces:'Bowl',      tags:'["⭐ Recomendado","🐟 Triple proteína"]', sort_order:4 },
    // Postres
    { id:'d1',  category:'Postres',   name:'Tres Leches',        description:'Bizcocho bañado en tres leches, suave y cremoso. Un clásico latino irresistible.',                                                                           price:6500,  pieces:'Porción',   tags:'["⭐ Recomendado"]',                sort_order:1 },
    { id:'d2',  category:'Postres',   name:'Flan Casero',        description:'Flan casero con caramelo. Simple y perfecto.',                                                                                                                price:5500,  pieces:'Porción',   tags:'[]',                                sort_order:2 },
    { id:'d3',  category:'Postres',   name:'Mango Masu Cake',    description:'Torta de mango y maracuyá, fresca y tropical. Inspirada en nuestro roll estrella.',                                                                          price:7000,  pieces:'Porción',   tags:'["🥭 Frutal"]',                     sort_order:3 },
    // Bebidas
    { id:'b1',  category:'Bebidas',   name:'Coca-Cola',          description:'Clásica, bien fría.',   price:2800, pieces:'500 ml', tags:'[]', sort_order:1 },
    { id:'b2',  category:'Bebidas',   name:'Coca-Cola Zero',     description:'Todo el sabor, sin azúcar.', price:2800, pieces:'500 ml', tags:'[]', sort_order:2 },
    { id:'b3',  category:'Bebidas',   name:'Fanta',              description:'Naranja, refrescante.', price:2800, pieces:'500 ml', tags:'[]', sort_order:3 },
    { id:'b4',  category:'Bebidas',   name:'Sprite',             description:'Lima-limón, bien fresca.', price:2800, pieces:'500 ml', tags:'[]', sort_order:4 },
    { id:'b5',  category:'Bebidas',   name:'Agua Mineral',       description:'Con o sin gas.',        price:2500, pieces:'500 ml', tags:'[]', sort_order:5 },
    // Cervezas
    { id:'cz1', category:'Cervezas',  name:'Heineken',           description:'Lager premium, cuerpo equilibrado.', price:4500, pieces:'473 ml', tags:'[]', sort_order:1 },
    { id:'cz2', category:'Cervezas',  name:'Brahma',             description:'Suave y refrescante.',  price:3800, pieces:'473 ml', tags:'[]', sort_order:2 },
    { id:'cz3', category:'Cervezas',  name:'Quilmes',            description:'La clásica argentina.', price:3800, pieces:'473 ml', tags:'[]', sort_order:3 },
  ];

  const insertMany = db.transaction((items) => {
    for (const item of items) insertItem.run(item);
  });
  insertMany(seedItems);
}

// ── Helpers exportados ─────────────────────────────────────────────────────

module.exports = {
  db,

  // Pedidos
  getOrders: (limit = 200) =>
    db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit),

  getOrder: (id) =>
    db.prepare('SELECT * FROM orders WHERE id = ?').get(id),

  createOrder: db.prepare(`
    INSERT INTO orders(id, name, phone, address, notes, items, subtotal, shipping, total, payment)
    VALUES(@id, @name, @phone, @address, @notes, @items, @subtotal, @shipping, @total, @payment)
  `),

  updateOrderStatus: db.prepare(
    'UPDATE orders SET status = ? WHERE id = ?'
  ),

  updateOrderPayment: db.prepare(
    'UPDATE orders SET mp_pref_id = ?, mp_payment_id = ?, status = ? WHERE id = ?'
  ),

  // Menú
  getMenuItems: (onlyActive = false) => {
    const sql = onlyActive
      ? 'SELECT * FROM menu_items WHERE active=1 ORDER BY category, sort_order'
      : 'SELECT * FROM menu_items ORDER BY category, sort_order';
    return db.prepare(sql).all();
  },

  updateMenuItem: db.prepare(`
    UPDATE menu_items
    SET name=@name, description=@description, price=@price,
        pieces=@pieces, tags=@tags, active=@active
    WHERE id=@id
  `),

  updateMenuItemImage: db.prepare(
    'UPDATE menu_items SET image=? WHERE id=?'
  ),

  createMenuItem: db.prepare(`
    INSERT INTO menu_items(id, category, name, description, price, pieces, tags, sort_order)
    VALUES(@id, @category, @name, @description, @price, @pieces, @tags, @sort_order)
  `),

  deleteMenuItem: db.prepare('DELETE FROM menu_items WHERE id=?'),

  // Settings
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? row.value : null;
  },

  getAllSettings: () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  updateSetting: db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ),
};
