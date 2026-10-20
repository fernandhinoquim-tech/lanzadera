// Vista previa rápida de la interfaz en Chromium con datos simulados (para desarrollo).
// Uso: NODE_PATH=<playwright> node scripts/preview.cjs <salida> <escenario...>
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { baseConfig, buildWorkspaces } = require('../src/main/defaults');
const { sanitizeConfig, deepMerge } = require('../src/main/store');

const root = path.join(__dirname, '..', 'src', 'renderer');
const out = path.resolve(process.argv[2] || 'preview-out');
const scenarios = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const paths = { home: 'C:\\Users\\Fer', desktop: 'C:\\Users\\Fer\\Desktop', documents: 'C:\\Users\\Fer\\Documents', downloads: 'C:\\Users\\Fer\\Downloads', pictures: 'C:\\Users\\Fer\\Pictures', music: 'C:\\Users\\Fer\\Music', videos: 'C:\\Users\\Fer\\Videos' };
const apps = ['Google Chrome', 'Microsoft Edge', 'Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote', 'Microsoft Teams', 'Bloc de notas', 'Calculadora', 'Herramienta Recortes', 'Paint', 'Terminal', 'Spotify', 'Steam', 'Xbox', 'Discord', 'WhatsApp', 'Fotos', 'Reproductor multimedia', 'Visual Studio Code', 'Configuración', 'Reloj', 'Mapas', 'Microsoft Store', 'Correo', 'Calendario', 'Cámara', 'Copilot', 'VLC media player', 'OBS Studio', '7-Zip File Manager', 'Adobe Acrobat', 'Canva', 'Notion', 'Zoom']
  .map((name, i) => ({ name, appId: 'App' + i, path: '' }));

function makeState(dark, patch = {}) {
  const cfg = deepMerge(baseConfig(), {});
  const ws = buildWorkspaces({ apps, paths, platform: 'win32' });
  cfg.workspaces = ws;
  cfg.activeWorkspace = ws[0].id;
  cfg.shelf = ['C:\\Users\\Fer\\Desktop\\Contrato.pdf', 'C:\\Users\\Fer\\Pictures\\Viaje.jpg'];
  cfg.notes = [{ id: 'n1', text: 'Llamar al dentista el jueves\nComprar regalo para mamá 🎁', color: 'ambar', ts: Date.now() }];
  cfg.customIcons = [];
  deepMerge(cfg, patch);
  return { config: sanitizeConfig(cfg), env: { dark, accent: '#6366F1', platform: 'win32', win11: true, version: '1.1.0', paths, displays: [{ id: '1', label: 'Pantalla integrada', primary: true, size: '1920×1080' }, { id: '2', label: 'DELL U2720Q', primary: false, size: '2560×1440' }], hotkeys: { search: true }, updater: { status: 'none', current: '1.0.0' }, dockHidden: false, packaged: true } };
}

const mockScript = (state) => `
(() => {
  let state = ${JSON.stringify(state)};
  const listeners = {};
  const emit = (ch, d) => (listeners[ch] || []).forEach((f) => f(d));
  const on = (ch) => (cb) => { (listeners[ch] ||= []).push(cb); return () => {}; };
  const now = Date.now();
  const files = ['Informe trimestral.pdf','Foto playa.jpg','Presupuesto 2026.xlsx','Canción favorita.mp3','Instalador.exe','Presentación.pptx','Notas.txt','Archivo.zip','Video vacaciones.mp4','Contrato firmado.docx']
    .map((n, i) => ({ name: n, path: 'C:\\\\Users\\\\Fer\\\\Downloads\\\\' + n, isDir: false, ext: n.split('.').pop(), mtime: now - i * 3600e3 * 3, size: 1024 * (i + 1) * 380 }));
  const deep = (t, s) => { for (const [k, v] of Object.entries(s)) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deep(t[k], v); else t[k] = v; } };
  window.__setState = (s) => { state = s; emit('state', state); };
  window.lanz = {
    platform: 'win32',
    getState: async () => state,
    onState: on('state'),
    patch: async (p) => { deep(state.config, JSON.parse(JSON.stringify(p))); emit('state', JSON.parse(JSON.stringify(state))); return true; },
    setItems: async (id, items) => { state.config.workspaces.find((w) => w.id === id).items = items; emit('state', JSON.parse(JSON.stringify(state))); return true; },
    launch: async () => true, launchMany: async () => ({ errors: [] }), reveal: async () => true,
    describePaths: async (ps) => ps.map((p) => ({ type: 'file', name: p.split('\\\\').pop(), target: p })),
    pathForFile: () => '',
    listFolder: async (p) => ({ path: p, total: files.length, entries: files }),
    recent: async () => files.slice(0, 7),
    watchFolders: () => {}, onFolderChanged: on('folder'), copyInto: async () => 1, trash: async () => true, startDrag: () => {},
    shelfAdd: async () => 1, shelfRemove: async () => true, shelfClear: async () => true, shelfTransfer: async () => ({ count: 0 }),
    pick: async () => [],
    apps: async () => ${JSON.stringify(apps)},
    searchIndex: async () => [
      ...${JSON.stringify(apps)}.map((a) => ({ key: 'app:' + a.appId, kind: 'app', title: a.name, subtitle: 'Aplicación', item: { type: 'app', name: a.name, appId: a.appId } })),
      { key: 'set:display', kind: 'setting', title: 'Pantalla', subtitle: 'Configuración de Windows', item: { type: 'url', name: 'Pantalla', target: 'ms-settings:display', icon: { kind: 'designed', glyph: 'settings', gradient: 'grafito' } } },
      { key: 'cmd:organize', kind: 'command', command: 'organize', title: 'Ordenar escritorio', subtitle: 'Lanzadera', item: { type: 'action', icon: { kind: 'designed', glyph: 'wand-sparkles', gradient: 'aurora' } } },
      ...files.map((f) => ({ key: 'f:' + f.path, kind: 'file', title: f.name, subtitle: 'C:\\\\Users\\\\Fer\\\\Downloads', item: { type: 'file', name: f.name, target: f.path } })),
    ],
    orgPlan: async () => ({ id: 'p1', folder: 'C:\\\\Users\\\\Fer\\\\Desktop', base: 'C:\\\\Users\\\\Fer\\\\Desktop\\\\Organizado', mode: 'container', moves: files.map((f, i) => ({ from: f.path, to: 'x', name: f.name, category: ['PDF','Imágenes','Hojas de cálculo','Música','Instaladores','Presentaciones','Documentos','Comprimidos','Videos','Documentos'][i], size: f.size })), skipped: [], categories: { PDF: 1, Imágenes: 1, 'Hojas de cálculo': 1, Música: 1, Instaladores: 1, Presentaciones: 1, Documentos: 2, Comprimidos: 1, Videos: 1 } }),
    orgApply: async () => ({ id: 'h1', moved: 10, failed: [] }),
    orgHistory: async () => [{ id: 'h0', date: now - 86400e3, folder: 'C:\\\\Users\\\\Fer\\\\Desktop', count: 23, undone: false }, { id: 'h00', date: now - 5 * 86400e3, folder: 'C:\\\\Users\\\\Fer\\\\Downloads', count: 41, undone: true }],
    orgUndo: async () => ({ restored: 10, failed: [] }),
    clipList: async () => ({ enabled: true, paused: false, items: [{ id: 'c1', text: 'https://github.com/fernandhinoquim-tech/lanzadera', ts: now - 60e3, pinned: true }, { id: 'c2', text: 'Reunión con el equipo el martes a las 10:00 en la sala 3', ts: now - 600e3 }, { id: 'c3', text: 'fernando@ejemplo.com', ts: now - 7200e3 }] }),
    clipCopy: async () => true, clipPin: async () => true, clipRemove: async () => true, clipClear: async () => true, clipPause: async () => true, onClip: on('clip'),
    metricsSubscribe: (on) => {
      if (!on || window.__mt) return;
      const hist = { cpu: [], mem: [], gpu: [], rx: [], tx: [], dr: [], dw: [] };
      let k = 0;
      const gen = () => {
        k++;
        const w = (a, b, f) => a + (b - a) * (0.5 + 0.5 * Math.sin(k / f + a));
        const now = { t: Date.now(), cpu: Math.round(w(12, 48, 3)), cores: Array.from({ length: 12 }, (_, i) => Math.round(w(5, 90, 2 + i))), cpuModel: 'Intel(R) Core(TM) i7-12700H', mem: Math.round(w(55, 63, 9)), memUsed: 10.2e9, memTotal: 16e9,
          gpu: { util: Math.round(w(4, 38, 4)), mem: 2.1e9, memTotal: 6e9, name: 'NVIDIA GeForce RTX 3060 Laptop GPU', temp: 54, fan: 31, power: 23 },
          net: { rx: w(2e4, 3.2e6, 2.5), tx: w(5e3, 4e5, 3) }, netTotals: { rx: 1.8e9, tx: 2.3e8 }, disk: { r: w(0, 4e7, 2), w: w(0, 1.5e7, 3.5), busy: Math.round(w(1, 22, 3)) },
          mhz: 3480, temps: [62], battery: { pct: 78, ac: false, secs: 11800 }, uptime: 93000, host: 'PC-FERNANDO',
          drives: [{ name: 'C:', label: 'Windows', total: 512e9, free: 201e9 }, { name: 'D:', label: 'Datos', total: 1e12, free: 80e9 }],
          procs: { count: 241, cpu: [['chrome', 12.4, 1.9e9], ['Code', 6.1, 8e8], ['explorer', 2.2, 1.6e8], ['Spotify', 1.8, 3.1e8], ['Teams', 1.1, 6.4e8], ['Lanzadera', 0.6, 1.4e8]], mem: [['chrome', 12.4, 1.9e9], ['Teams', 1.1, 6.4e8], ['Code', 6.1, 8e8]] } };
        const zone = (v, c, k) => (v >= k ? 'crit' : v >= c ? 'warn' : 'ok');
        const sens = (key, label, value, caution, critical, source, limits) => ({ key, label, value, caution, critical, source, limits, zone: zone(value, caution, critical), max: Math.ceil((critical + 15) / 10) * 10 });
        now.sensors = [
          sens('cpu', 'Procesador', Math.round(w(58, 66, 5)), 80, 95, 'Sensor térmico de la placa (ACPI)', 'habituales'),
          sens('gpu', 'Gráfica', Math.round(w(82, 88, 4)), 83, 93, 'NVIDIA GeForce RTX 3060 Laptop GPU', 'de la tarjeta'),
          sens('disk0', 'SSD', Math.round(w(44, 47, 9)), 72, 82, 'Samsung SSD 980 PRO 1TB', 'del fabricante'),
        ];
        now.gpu.temp = now.sensors[1].value;
        for (const [kk, v] of [['cpu', now.cpu], ['mem', now.mem], ['gpu', now.gpu.util], ['rx', now.net.rx], ['tx', now.net.tx], ['dr', now.disk.r], ['dw', now.disk.w]]) { hist[kk].push(v); if (hist[kk].length > 90) hist[kk].shift(); }
        window.__mlast = { now, hist };
        emit('metrics', window.__mlast);
      };
      for (let i = 0; i < 60; i++) gen();
      window.__mt = setInterval(gen, 1000);
    },
    metricsSnapshot: async () => window.__mlast || null,
    onMetrics: on('metrics'),
    monitorResize: () => {},
    sysStats: async () => ({ cpu: 23, mem: 61, memUsed: 9.8e9, memTotal: 16e9, disk: { total: 512e9, free: 201e9, root: 'C:\\\\' }, uptime: 93000, cpuModel: 'Intel(R) Core(TM) i7-1255U', cores: 12 }),
    suggestions: async () => state.config.workspaces[0].items.filter((i) => i.type === 'app').slice(0, 4),
    running: async () => state.config.workspaces[0].items.filter((i) => i.type === 'app').slice(0, 2).map((i) => i.id),
    onRunning: on('running'),
    onDodge: on('dodge'),
    reportBar: () => {},
    categorize: async (items) => items.map(() => 'Oficina'),
    planApply: async () => ({ added: 2, groups: 3 }),
    planPreview: async () => {
      const a = ${JSON.stringify(apps)};
      const it = (n) => ({ type: 'app', name: n, appId: (a.find((x) => x.name === n) || {}).appId || n });
      return {
        mostUsed: { source: 'windows', items: ['Google Chrome', 'Word', 'Excel', 'WhatsApp', 'Spotify', 'Visual Studio Code'].map(it) },
        desktop: { count: 14, groups: [
          { name: 'Oficina', gradient: 'indigo', items: ['Word', 'Excel', 'PowerPoint', 'Adobe Acrobat'].map(it) },
          { name: 'Comunicación', gradient: 'menta', items: ['WhatsApp', 'Microsoft Teams', 'Zoom'].map(it) },
          { name: 'Juegos', gradient: 'atardecer', items: ['Steam', 'Xbox'].map(it) },
          { name: 'Multimedia', gradient: 'rosa', items: ['Spotify', 'VLC media player', 'OBS Studio'].map(it) },
          { name: 'Otros', gradient: 'aurora', items: ['Notion', 'Canva'].map(it) },
        ] },
      };
    },
    uploadIcons: async () => [], importIcons: async () => [], deleteIcon: async () => true, clearIconCache: async () => true, onIconsRefresh: on('icons'),
    exportBackup: async () => ({}), importBackup: async () => ({}), resetAll: async () => true,
    appInfo: async () => ({ version: '1.1.0', electron: '44.5.1', chrome: '146', userData: 'C:\\\\Users\\\\Fer\\\\AppData\\\\Roaming\\\\Lanzadera', updater: { status: 'none' } }),
    checkUpdate: async () => true, installUpdate: async () => true, onUpdate: on('update'), hotkeyStatus: async () => ({ search: true }), run: async () => true,
    setInteractive: () => {}, raise: () => {}, cursor: async () => null, focusDock: () => {}, openPanel: () => {}, openSearch: () => {}, hideSearch: () => {},
    onSearchShown: on('shown'), onSearchHidden: on('hidden'), onRoute: on('route'), closeWindow: () => {}, minimizeWindow: () => {},
  };
  window.__emit = emit;
})();`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const open = async (url, { w = 1600, h = 620, dark = true, patch = {} } = {}) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => errors.push(url + ': ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/lanz:|ERR_UNKNOWN_URL_SCHEME|Failed to load resource/.test(m.text()) && errors.push(url + ': ' + m.text()));
    await page.addInitScript(mockScript(makeState(dark, patch)));
    await page.goto(base + url);
    await wait(700);
    return page;
  };
  for (const sc of scenarios) {
    const [kind, ...rest] = sc.split(':');
    const arg = rest.join(':');
    try {
      if (kind === 'dock') {
        const opts = arg ? JSON.parse(arg) : {};
        const page = await open('/dock/index.html', { dark: opts.dark !== false, patch: opts.patch || {}, w: opts.w || 1600, h: opts.h || 620 });
        if (opts.hover !== undefined) {
          await page.evaluate((f) => { const r = document.querySelector('.dock-bg').getBoundingClientRect(); const v = ['left','right'].includes(window.__lzTest.edge()); window.__lzTest.pointer(v ? r.left + r.width / 2 : r.left + r.width * f, v ? r.top + r.height * f : r.top + r.height / 2); }, opts.hover);
          await wait(400);
          await page.evaluate((f) => { const r = document.querySelector('.dock-bg').getBoundingClientRect(); const v = ['left','right'].includes(window.__lzTest.edge()); window.__lzTest.pointer(v ? r.left + r.width / 2 : r.left + r.width * f, v ? r.top + r.height * f : r.top + r.height / 2); }, opts.hover);
          await wait(600);
        }
        if (opts.open) {
          await page.evaluate((p) => window.__lzTest.open(p), opts.open);
          await wait(900);
        }
        if (opts.menu) {
          await page.evaluate(() => window.__lzTest.menu());
          await wait(300);
        }
        await page.screenshot({ path: path.join(out, (opts.name || 'dock') + '.png'), omitBackground: true });
        await page.close();
      } else if (kind === 'panel') {
        const opts = arg ? JSON.parse(arg) : {};
        const page = await open('/panel/index.html#' + (opts.route || '/inicio'), { w: opts.w || 1120, h: opts.h || 780, dark: opts.dark !== false, patch: opts.patch || {} });
        await wait(opts.wait || 600);
        if (opts.click) for (const c of [].concat(opts.click)) { await page.click(c); await wait(500); }
        if (opts.scroll) { await page.evaluate((y) => (document.getElementById('content').scrollTop = y), opts.scroll); await wait(300); }
        await page.screenshot({ path: path.join(out, (opts.name || 'panel') + '.png') });
        await page.close();
      } else if (kind === 'monitor') {
        const opts = arg ? JSON.parse(arg) : {};
        const page = await open('/monitor/index.html?mode=' + (opts.mode || 'compact'), { w: opts.w || 350, h: opts.h || 760, dark: opts.dark !== false, patch: opts.patch || {} });
        await page.evaluate(() => window.lanz.metricsSubscribe(true));
        await wait(1500);
        if (opts.hover) {
          await page.hover(opts.hover);
          await wait(900);
        }
        await page.screenshot({ path: path.join(out, (opts.name || 'monitor') + '.png'), omitBackground: true });
        await page.close();
      } else if (kind === 'search') {
        const opts = arg ? JSON.parse(arg) : {};
        const page = await open('/search/index.html', { w: 760, h: 560, dark: opts.dark !== false });
        await page.evaluate((q) => window.__emit('shown', { query: q }), opts.q || '');
        await wait(700);
        await page.screenshot({ path: path.join(out, (opts.name || 'search') + '.png'), omitBackground: true });
        await page.close();
      }
    } catch (e) {
      errors.push(sc + ': ' + e.message);
    }
  }
  await browser.close();
  server.close();
  console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'sin errores');
})();
