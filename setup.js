/**
 * setup.js — Nakamura Sushi Roll
 * Copia el index.html original a public/ e inyecta el script de integración.
 * Ejecutar: node setup.js
 */
const fs   = require('fs');
const path = require('path');

const src  = path.join(__dirname, 'index.html');   // HTML original (copiar aquí)
const dest = path.join(__dirname, 'public', 'index.html');

// Asegurarse que exista la carpeta public/
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
}

// Verificar que existe el HTML original
if (!fs.existsSync(src)) {
  console.error('❌  No se encontró index.html en la raíz del proyecto.');
  console.error('    Copiá tu index.html a:');
  console.error('   ', src);
  process.exit(1);
}

let html = fs.readFileSync(src, 'utf8');

// Inyectar el script de integración antes de </body>
const injection = '\n<script src="/api-integration.js"></script>\n';

if (html.includes('api-integration.js')) {
  console.log('ℹ️  api-integration.js ya estaba inyectado.');
} else if (html.includes('</body>')) {
  html = html.replace('</body>', injection + '</body>');
  console.log('✅  Script de integración inyectado.');
} else {
  html += injection;
  console.log('⚠️  No se encontró </body> — script agregado al final.');
}

fs.writeFileSync(dest, html, 'utf8');
console.log('✅  public/index.html listo:', dest);
console.log('\n🍣  Siguiente paso: npm install && node server.js\n');
