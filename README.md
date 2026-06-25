# 🍣 Nakamura Sushi Roll — Aplicación Completa

Delivery de sushi premium con backend Node.js, panel de administración y pagos online con MercadoPago.

## Estructura del proyecto

```
nakamura-sushi-roll/
├── server.js            ← Servidor Express (API REST)
├── database.js          ← SQLite con better-sqlite3
├── setup.js             ← Script de instalación (copia index.html + inyecta scripts)
├── package.json
├── .env                 ← Variables de entorno (crear desde .env.example)
├── .env.example
├── index.html           ← Tu HTML original (copiarlo aquí)
├── nakamura.db          ← Base de datos SQLite (se crea automáticamente)
└── public/
    ├── index.html       ← Frontend generado por setup.js
    ├── api-integration.js ← Script que conecta el frontend con el backend
    ├── pago-resultado.html ← Páginas de resultado de MercadoPago
    └── admin/
        └── index.html   ← Panel de administración
```

## Instalación paso a paso

### 1. Instalar Node.js

Descargalo desde https://nodejs.org (versión 18 o superior).

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editá el archivo `.env`:

```env
PORT=3000
MP_ACCESS_TOKEN=TEST-tu-token-de-mercadopago
MP_PUBLIC_KEY=TEST-tu-public-key
BASE_URL=http://localhost:3000
ADMIN_USER=admin
ADMIN_PASS=tu-contraseña-segura
SESSION_SECRET=una-clave-aleatoria-larga
```

### 4. Preparar el frontend

Copiá tu `index.html` original a la raíz del proyecto y ejecutá:

```bash
node setup.js
```

Esto crea `public/index.html` con el script de integración inyectado.

### 5. Arrancar el servidor

```bash
node server.js
```

O, para desarrollo con recarga automática:

```bash
npm run dev
```

La aplicación estará disponible en:
- **Frontend (menú):** http://localhost:3000
- **Panel admin:** http://localhost:3000/admin

---

## Panel de Administración

Ingresá con las credenciales definidas en `.env` (`ADMIN_USER` / `ADMIN_PASS`).

### Funciones disponibles:
- **Dashboard:** estadísticas en tiempo real (pedidos del día, pendientes, facturación)
- **Pedidos:** ver todos los pedidos y cambiar su estado (pendiente → preparando → listo → entregado)
- **Menú:** activar/desactivar ítems y editar nombre, descripción y precio
- **Configuración:** cambiar nombre del restaurante, WhatsApp, costo de envío y pedido mínimo

---

## MercadoPago

### Credenciales de prueba

1. Entrá a https://www.mercadopago.com.ar/developers/panel
2. Creá una aplicación
3. Copiá el **Access Token de prueba** y el **Public Key** en tu `.env`

### Tarjetas de prueba

| Tipo | Número | Vencimiento | CVV |
|------|--------|-------------|-----|
| Visa aprobada | 4509 9535 6623 3704 | 11/25 | 123 |
| Visa rechazada | 4000 0000 0000 0002 | 11/25 | 123 |

---

## API Endpoints

### Públicos
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/menu` | Obtener menú activo |
| `GET` | `/api/settings` | Configuración pública |
| `POST` | `/api/orders` | Crear un pedido |
| `GET` | `/api/orders/:id` | Estado de un pedido |
| `POST` | `/api/orders/:id/checkout` | Crear preferencia MercadoPago |

### Admin (requieren header `Authorization: Basic base64(user:pass)`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/orders` | Todos los pedidos |
| `PATCH` | `/api/admin/orders/:id/status` | Cambiar estado |
| `GET` | `/api/admin/menu` | Menú completo |
| `PATCH` | `/api/admin/menu/:id` | Editar ítem |
| `GET/PATCH` | `/api/admin/settings` | Configuración |
| `GET` | `/api/admin/stats` | Estadísticas |

---

## Puesta en producción

Para publicar la app en internet (ej. en un VPS o Railway):

1. Cambiar `BASE_URL` en `.env` a tu dominio real
2. Usar credenciales de producción de MercadoPago (no TEST-)
3. Cambiar `ADMIN_PASS` por una contraseña segura
4. Usar un proceso manager como PM2: `pm2 start server.js --name nakamura`
