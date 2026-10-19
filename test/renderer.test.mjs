import test from 'node:test';
import assert from 'node:assert';
import { calculate, looksLikeMath } from '../src/renderer/shared/calc.js';
import { search, scoreText } from '../src/renderer/shared/fuzzy.js';
import { tileSVG, TILE_STYLES, GRADIENTS } from '../src/renderer/shared/tiles.js';
import { autoDesign, fileTypeOf } from '../src/renderer/shared/autoicon.js';
import { searchIcons } from '../src/renderer/shared/icon-es.js';
import { GLYPHS } from '../src/renderer/shared/icon-bank.js';
import { FLUENT } from '../src/renderer/shared/fluent-bank.js';
import { ACTION_DESIGN, WIDGET_DESIGN } from '../src/renderer/shared/autoicon.js';
import { searchFluent } from '../src/renderer/shared/icon-es.js';
import { seriesMarkup, fmtRateShort } from '../src/renderer/shared/charts.js';
import { existsSync, readFileSync } from 'node:fs';

test('calculadora segura', () => {
  assert.equal(calculate('12*(3+4)'), 84);
  assert.equal(calculate('2^10'), 1024);
  assert.equal(calculate('80*15%'), 12);
  assert.equal(calculate('-3+5'), 2);
  assert.equal(calculate('1,5 x 2'), 3);
  assert.throws(() => calculate('alert(1)'));
  assert.ok(looksLikeMath('2+2'));
  assert.ok(!looksLikeMath('chrome'));
  assert.ok(!looksLikeMath('2026'));
});

test('búsqueda difusa insensible a tildes', () => {
  assert.ok(scoreText('Configuración', 'configuracion') > 90);
  const entries = [{ title: 'Visual Studio Code', kind: 'app' }, { title: 'Calculadora', kind: 'app' }, { title: 'Música', kind: 'folder' }];
  assert.equal(search(entries, 'vsc')[0].title, 'Visual Studio Code');
  assert.equal(search(entries, 'musica')[0].title, 'Música');
});

test('los mosaicos se generan en todos los estilos sin glifos inválidos', () => {
  for (const s of TILE_STYLES) for (const g of GRADIENTS.slice(0, 3)) {
    const svg = tileSVG({ glyph: 'folder', colors: g.c, style: s.id });
    assert.match(svg, /^<svg class="tile"/);
    assert.ok(!svg.includes('undefined'));
  }
});

test('iconos automáticos usan glifos existentes', () => {
  const samples = [
    { type: 'app', name: 'Google Chrome' }, { type: 'app', name: 'Excel' }, { type: 'app', name: 'Steam' }, { type: 'app', name: 'Programa raro' },
    { type: 'folder', name: 'Descargas' }, { type: 'file', name: 'x.pdf', target: 'x.pdf' }, { type: 'url', name: 'YouTube', target: 'https://youtube.com' },
  ];
  for (const s of samples) {
    const d = autoDesign(s);
    if (d.glyph) assert.ok(GLYPHS[d.glyph], `${s.name} → ${d.glyph}`);
    else assert.ok(d.text);
  }
  assert.equal(fileTypeOf('foto.JPEG'), 'imagen');
});

test('el banco de iconos busca en español', () => {
  assert.ok(searchIcons('musica').includes('music'));
  assert.ok(searchIcons('carpeta').includes('folder'));
  assert.ok(searchIcons('juego').some((n) => n.startsWith('gamepad')));
});

test('los iconos 3D usados existen', () => {
  const src = readFileSync(new URL('../src/renderer/shared/autoicon.js', import.meta.url), 'utf8');
  const codes = [...src.matchAll(/'([0-9a-f]{4,5}(?:-[0-9a-f]{4})*)'/g)].map((m) => m[1]);
  for (const d of [...Object.values(ACTION_DESIGN), ...Object.values(WIDGET_DESIGN)]) codes.push(d.fluent);
  for (const c of new Set(codes)) assert.ok(existsSync(new URL(`../src/renderer/assets/fluent/${c}.webp`, import.meta.url)), `falta ${c}`);
  assert.ok(FLUENT.length > 1000);
  assert.equal(autoDesign({ type: 'folder', name: 'Descargas' }).fluent, '1f4e5');
});

test('el banco 3D busca en español', () => {
  assert.ok(searchFluent('carpeta').includes('1f4c1'));
  assert.ok(searchFluent('musica').length > 0);
  assert.ok(searchFluent('gato').some((c) => c.startsWith('1f431') || c.startsWith('1f408')));
});

test('gráficas del monitor', () => {
  const svg = seriesMarkup([{ values: [1, 5, 3, 8], colors: ['#000', '#fff'] }], { max: 10 });
  assert.match(svg, /<path d="M/);
  assert.equal(fmtRateShort(1536), '2K');
  assert.equal(fmtRateShort(2.5 * 1048576), '2,5M');
});
