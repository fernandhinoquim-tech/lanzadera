const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { categoryOf, groupByCategory } = require('../src/main/categories');
const { arrangeZones, placeInZones, rankApps, desktopGroups } = require('../src/main/dockplan');
const { migrate, sanitizeConfig, deepMerge } = require('../src/main/store');
const { baseConfig } = require('../src/main/defaults');
const { matchWindows } = require('../src/main/running');
const { dockArea, intersects } = require('../src/main/windows');

const app = (name, extra = {}) => ({ id: name, type: 'app', name, ...extra });
const kinds = (items) => items.map((i) => (i.type === 'separator' ? '|' : i.type === 'group' ? `[${i.name}]` : i.name || i.type));

test('clasifica programas y sitios por tema', () => {
  assert.equal(categoryOf(app('Microsoft Word')).name, 'Oficina');
  assert.equal(categoryOf(app('Steam')).name, 'Juegos');
  assert.equal(categoryOf(app('WhatsApp')).name, 'Comunicación');
  assert.equal(categoryOf(app('Visual Studio Code')).name, 'Programación');
  assert.equal(categoryOf(app('Notepad++')).name, 'Programación');
  assert.equal(categoryOf(app('Internet Explorer')).name, 'Internet');
  assert.equal(categoryOf(app('IBM SPSS Statistics')).name, 'Estudio y ciencia');
  assert.equal(categoryOf({ type: 'url', name: 'Videos', target: 'https://www.youtube.com/' }).name, 'Multimedia');
  assert.equal(categoryOf({ type: 'url', name: 'Mi blog', target: 'https://ejemplo.org' }).name, 'Sitios web');
  assert.equal(categoryOf({ type: 'folder', name: 'Tareas', target: 'C:\\x' }).name, 'Carpetas');
  assert.equal(categoryOf(app('Algo desconocido')).name, 'Otros');
});

test('agrupa por tema, quita duplicados y junta los sueltos en «Otros»', () => {
  const groups = groupByCategory([
    app('Word', { target: 'C:\\D\\Word.lnk' }),
    app('Excel', { target: 'C:\\D\\Excel.lnk' }),
    app('Word', { target: 'C:\\P\\Word.lnk' }),
    app('Steam', { target: 'C:\\D\\Steam.lnk' }),
    app('Raro', { target: 'C:\\D\\Raro.lnk' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.name, g.items.map((i) => i.name)]), [
    ['Oficina', ['Word', 'Excel']],
    ['Otros', ['Steam', 'Raro']],
  ]);
});

test('ordena la barra en dos zonas: favoritos | grupos | lo demás', () => {
  const items = [
    { id: 'w', type: 'widget', widget: 'clock' },
    app('Chrome'),
    { id: 'g', type: 'group', name: 'Oficina', items: [] },
    { id: 's1', type: 'separator' },
    app('Word'),
    { id: 'st', type: 'folderStack', name: 'Descargas' },
  ];
  assert.deepEqual(kinds(arrangeZones(items)), ['Chrome', 'Word', '|', '[Oficina]', '|', 'widget', 'Descargas']);
});

test('agrega favoritos y grupos sin duplicar y completando grupos con el mismo nombre', () => {
  const items = [app('Chrome', { appId: 'Chrome' }), { id: 's', type: 'separator' }, { id: 'g', type: 'group', name: 'Oficina', items: [app('Word', { appId: 'Word' })] }, { id: 's2', type: 'separator' }, { id: 't', type: 'action', action: 'trash', name: 'Papelera' }];
  const res = placeInZones(items, {
    favorites: [app('Chrome', { appId: 'Chrome' }), app('Zotero', { appId: 'Zotero' })],
    groups: [
      { name: 'oficina', gradient: 'indigo', items: [app('Word', { appId: 'Word' }), app('Excel', { appId: 'Excel' })] },
      { name: 'Juegos', gradient: 'atardecer', items: [app('Steam'), app('Roblox')] },
    ],
  });
  assert.equal(res.added, 1);
  assert.equal(res.groups, 1);
  assert.deepEqual(kinds(res.items), ['Chrome', 'Zotero', '|', '[Oficina]', '[Juegos]', '|', 'Papelera']);
  assert.deepEqual(res.items[3].items.map((i) => i.name), ['Word', 'Excel']);
  const ids = res.items.flatMap((i) => [i.id, ...(i.items || []).map((k) => k.id)]);
  assert.equal(new Set(ids).size, ids.length, 'los ids no se repiten');
});

test('los grupos no repiten lo que ya está en la primera zona', () => {
  const res = placeInZones([app('Google Chrome', { appId: 'Chrome' })], {
    groups: [{ name: 'Internet', items: [app('Google Chrome', { target: 'C:\\D\\Google Chrome.lnk' }), app('Firefox')] }],
  });
  assert.deepEqual(kinds(res.items), ['Google Chrome', '|', '[Internet]']);
  assert.deepEqual(res.items[2].items.map((i) => i.name), ['Firefox']);
});

test('sin reordenar, los grupos nuevos van después del último grupo', () => {
  const items = [app('A'), { id: 'g', type: 'group', name: 'G', items: [] }, { id: 'w', type: 'widget', widget: 'clock' }];
  const res = placeInZones(items, { favorites: [app('B')], groups: [{ name: 'Juegos', items: [app('Steam')] }], arrange: false });
  assert.deepEqual(kinds(res.items), ['A', 'B', '[G]', '[Juegos]', 'widget']);
});

test('los más usados según Windows se relacionan con las apps del menú Inicio', () => {
  const apps = [
    { name: 'Google Chrome', appId: 'Chrome', path: '' },
    { name: 'Word', appId: 'Microsoft.Office.WINWORD.EXE.15', path: '' },
    { name: 'Paint', appId: 'Microsoft.Paint_8wekyb3d8bbwe!App', path: '' },
    { name: 'Lanzadera', appId: 'com.lanzadera.app', path: '' },
  ];
  const now = Date.now();
  const ranked = rankApps(
    apps,
    [
      { id: 'Chrome', runs: 40, focus: 50 * 3600000, last: now },
      { id: 'Microsoft.Office.WINWORD.EXE.15', runs: 10, focus: 2 * 3600000, last: now - 40 * 86400000 },
      { id: '{9E3995AB-1F9C-4F13-B827-48B24B6C7174}\\TaskBar\\Paint.lnk', runs: 2, focus: 60000, last: now },
      { id: 'com.lanzadera.app', runs: 99, focus: 99999999, last: now },
      { id: 'Desconocido', runs: 5, focus: 1000, last: now },
    ],
    now
  );
  assert.deepEqual(ranked.map((r) => r.app.name), ['Google Chrome', 'Word', 'Paint']);
});

test('lee los accesos directos de una carpeta y los agrupa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-desk-'));
  try {
    fs.writeFileSync(path.join(dir, 'YouTube.url'), '[InternetShortcut]\nURL=https://www.youtube.com/\n');
    fs.writeFileSync(path.join(dir, 'Netflix.url'), '[InternetShortcut]\nURL=https://www.netflix.com/\n');
    fs.writeFileSync(path.join(dir, 'notas.txt'), 'no es un acceso');
    fs.writeFileSync(path.join(dir, 'desktop.ini'), '');
    const res = await desktopGroups(null, [dir]);
    assert.equal(res.count, 2);
    assert.deepEqual(res.groups.map((g) => g.name), ['Multimedia']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la migración saca las métricas de la barra y activa el monitor del escritorio', () => {
  const raw = {
    schema: 1,
    monitor: { gadget: false, onTop: true },
    workspaces: [
      {
        id: 'w',
        name: 'P',
        items: [app('Chrome'), { type: 'separator' }, { type: 'widget', widget: 'cpu' }, { type: 'widget', widget: 'ram' }, { type: 'separator' }, { type: 'widget', widget: 'clock' }],
      },
    ],
  };
  const c = migrate(sanitizeConfig(deepMerge(baseConfig(), raw)));
  assert.equal(c.schema, 2);
  assert.equal(c.monitor.gadget, true);
  assert.equal(c.monitor.onTop, false);
  assert.equal(c.position.windows, 'reserve');
  assert.deepEqual(c.workspaces[0].items.map((i) => i.widget || i.type), ['app', 'separator', 'clock']);
});

test('el botón de la barra de tareas deja de ser un modo de reposo', () => {
  const old = sanitizeConfig(deepMerge(baseConfig(), { position: { idle: 'taskbar', windows: 'desktop' } }));
  assert.equal(old.position.idle, 'compact', 'la barra vuelve a verse en el escritorio');
  assert.equal(old.position.taskbarButton, true, 'el botón sigue activo');
  assert.equal(old.position.windows, 'desktop');
  assert.equal(sanitizeConfig(deepMerge(baseConfig(), {})).position.taskbarButton, false);
});

test('las ventanas abiertas se reconocen por id de aplicación o por ejecutable', () => {
  const wins = [
    { h: 1, p: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', a: 'Chrome' },
    { h: 2, p: 'C:\\Windows\\explorer.exe', a: '' },
    { h: 3, p: 'C:\\Windows\\System32\\notepad.exe', a: '' },
  ];
  assert.deepEqual(matchWindows(app('Chrome', { appId: 'Chrome' }), wins).map((w) => w.h), [1]);
  assert.deepEqual(matchWindows(app('Bloc', { target: 'C:\\Windows\\System32\\NOTEPAD.EXE' }), wins).map((w) => w.h), [3]);
  assert.deepEqual(matchWindows(app('Nada', { target: 'C:\\x\\otro.exe' }), wins), []);
  assert.deepEqual(matchWindows({ type: 'url', target: 'https://a' }, wins), []);
});

test('el área del dock suma la franja que él mismo reservó', () => {
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 972 } };
  const reserved = { x: 0, y: 972, width: 1920, height: 60, edge: 'bottom' };
  assert.deepEqual(dockArea(display, { edge: 'bottom' }, reserved), { x: 0, y: 0, width: 1920, height: 1032 });
  assert.deepEqual(dockArea(display, { edge: 'top' }, reserved), display.workArea, 'otra orilla no cuenta');
  assert.deepEqual(dockArea(display, { edge: 'bottom', overTaskbar: true }, reserved), display.bounds);
  const left = { bounds: display.bounds, workArea: { x: 70, y: 0, width: 1850, height: 1032 } };
  assert.deepEqual(dockArea(left, { edge: 'left' }, { x: 0, y: 0, width: 70, height: 1032, edge: 'left' }), { x: 0, y: 0, width: 1920, height: 1032 });
  assert.ok(intersects({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 90, width: 50, height: 50 }));
  assert.ok(!intersects({ x: 0, y: 0, width: 100, height: 100 }, { x: 95, y: 95, width: 50, height: 50 }, 8), 'los bordes invisibles no cuentan');
});

test('las temperaturas usan los límites del componente y marcan la zona', () => {
  const { buildSensors } = require('../src/main/metrics');
  const s = buildSensors({ temps: [61.4, 40], gpuTemp: { value: 88.6, warn: 93 }, gpuName: 'RTX', disks: [{ name: 'SSD X', t: 83, warn: 82, crit: 85 }, { name: 'SSD Y', t: 40, warn: 0, crit: 0 }] });
  assert.deepEqual(s.map((x) => [x.key, x.label, x.value, x.caution, x.critical, x.zone]), [
    ['cpu', 'Procesador', 61, 80, 95, 'ok'],
    ['gpu', 'Gráfica', 89, 83, 93, 'warn'],
    ['disk0', 'SSD 1', 83, 72, 82, 'crit'],
    ['disk1', 'SSD 2', 40, 60, 70, 'ok'],
  ]);
  assert.equal(s[1].limits, 'de la tarjeta');
  assert.equal(s[3].limits, 'habituales');
  assert.ok(s.every((x) => x.max >= x.critical + 10));
});

test('avisa una sola vez cuando una temperatura se queda en zona crítica', () => {
  const { Metrics } = require('../src/main/metrics');
  const m = new Metrics({ config: () => ({ alerts: true }) });
  const alerts = [];
  m.on('alert', (s) => alerts.push(s.key));
  const hot = [{ key: 'gpu', zone: 'crit' }];
  for (let i = 0; i < 6; i++) m.checkAlerts(hot);
  m.checkAlerts([{ key: 'gpu', zone: 'ok' }]);
  for (let i = 0; i < 3; i++) m.checkAlerts(hot);
  assert.deepEqual(alerts, ['gpu'], 'el segundo episodio cae dentro de la espera de 10 minutos');
  const off = new Metrics({ config: () => ({ alerts: false }) });
  off.on('alert', () => alerts.push('x'));
  for (let i = 0; i < 4; i++) off.checkAlerts(hot);
  assert.deepEqual(alerts, ['gpu']);
});

test('toma la temperatura del procesador de LibreHardwareMonitor', () => {
  const { cpuTempFromTree } = require('../src/main/sensors');
  const tree = { Text: 'Sensor', Children: [{ Text: 'PC', Children: [
    { Text: 'Intel Core i7', ImageURL: 'images_icon/cpu.png', Children: [{ Text: 'Temperatures', Children: [
      { Text: 'CPU Core #1', Value: '58,0 °C', SensorId: '/intelcpu/0/temperature/0', Type: 'Temperature', Children: [] },
      { Text: 'CPU Package', Value: '63,5 °C', SensorId: '/intelcpu/0/temperature/8', Type: 'Temperature', Children: [] },
    ] }] },
    { Text: 'NVIDIA GeForce', ImageURL: 'images_icon/nvidia.png', Children: [{ Text: 'Temperatures', Children: [{ Text: 'GPU Core', Value: '70,0 °C', Type: 'Temperature', Children: [] }] }] },
  ] }] };
  assert.deepEqual(cpuTempFromTree(tree), { value: 63.5, src: 'LibreHardwareMonitor', name: 'CPU Package' });
  const amd = { Children: [{ Text: 'AMD Ryzen 7', ImageURL: 'images_icon/cpu.png', Children: [{ Text: 'Core (Tctl/Tdie)', Value: '0,0 °C', SensorId: '/amdcpu/0/temperature/2', Children: [] }] }] };
  assert.equal(cpuTempFromTree(amd), null, 'sin el controlador PawnIO, AMD informa 0 °C y se descarta');
});

test('hasCpu distingue «falta PawnIO» de un árbol sin procesador', () => {
  const { hasCpu } = require('../src/main/sensors');
  const noTemps = { Children: [{ Text: 'PC', Children: [{ Text: 'Intel Core i5', ImageURL: 'images_icon/cpu.png', Children: [{ Text: 'Load', Children: [{ Text: 'CPU Total', Value: '12,0 %', SensorId: '/intelcpu/0/load/0', Children: [] }] }] }] }] };
  assert.equal(hasCpu(noTemps), true);
  assert.equal(hasCpu({ Children: [{ Text: 'PC', Children: [{ Text: 'Generic Memory', ImageURL: 'images_icon/ram.png', Children: [] }] }] }), false);
});
