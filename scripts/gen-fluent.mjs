// Genera el banco de iconos 3D (Fluent Emoji de Microsoft) con nombres en español.
// Copia los .webp a src/renderer/assets/fluent y crea src/renderer/shared/fluent-bank.js.
// Uso: npm run gen:fluent
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(dirname(require.resolve('@lobehub/fluent-emoji-3d/package.json')), 'assets');
const es = require('emojibase-data/es/data.json');
const en = require('emojibase-data/en/data.json');
const out = join(root, 'src/renderer/assets/fluent');

const GROUPS = { 0: 'caras', 3: 'naturaleza', 4: 'comida', 5: 'lugares', 6: 'actividades', 7: 'objetos', 8: 'simbolos' };
const files = new Set(readdirSync(assets).map((f) => f.replace(/\.webp$/, '')));
const enByHex = new Map(en.map((e) => [e.hexcode, e]));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const list = [];
for (const e of es.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
  const group = GROUPS[e.group];
  if (!group) continue;
  const hex = e.hexcode.toLowerCase();
  const file = files.has(hex) ? hex : files.has(hex + '-fe0f') ? hex + '-fe0f' : null;
  if (!file) continue;
  copyFileSync(join(assets, file + '.webp'), join(out, file + '.webp'));
  const enLabel = enByHex.get(e.hexcode)?.label || '';
  list.push([file, e.label, (e.tags || []).join(','), enLabel, group]);
}

const js = `// Archivo generado por scripts/gen-fluent.mjs — no editar a mano.
// Iconos 3D: Fluent Emoji de Microsoft (licencia MIT). Nombres: Emojibase (MIT). Ver THIRD_PARTY_NOTICES.md.
// [archivo, nombre, etiquetas, nombre en inglés, grupo]
export const FLUENT = ${JSON.stringify(list)};
export const FLUENT_GROUPS = ${JSON.stringify({ destacados: 'Destacados', objetos: 'Objetos', simbolos: 'Símbolos', naturaleza: 'Naturaleza', comida: 'Comida', actividades: 'Actividades', lugares: 'Viajes y lugares', caras: 'Caras' })};
`;
writeFileSync(join(root, 'src/renderer/shared/fluent-bank.js'), js);
console.log(`${list.length} iconos 3D copiados; índice de ${(js.length / 1024).toFixed(0)} KB`);
if (!existsSync(join(out, '1f4c1.webp'))) throw new Error('Falta la carpeta 📁');
