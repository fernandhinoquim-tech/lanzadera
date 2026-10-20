// Configuración inicial y dock de bienvenida armado con las apps encontradas en el equipo.
const path = require('path');
const { newId: id } = require('./ids');

function baseConfig() {
  return {
    schema: 2,
    firstRun: true,
    seenVersion: '',
    appearance: {
      theme: 'system', // system | dark | light
      accent: 'system',
      dockStyle: 'glass', // glass | solid | clear | accent
      opacity: 0.86,
      iconSize: 50,
      magnification: 1.75,
      magnifyRange: 2.6,
      iconMode: 'original', // original | designed
      iconPack: 'fluent3d', // fluent3d | glyph
      fluentBg: 'none', // none | tile
      tileStyle: 'fluent',
      tileShape: 'squircle',
      labels: 'hover', // hover | always | never
      animations: true,
      bounce: true,
      thumbnails: true,
    },
    position: {
      edge: 'bottom', // bottom | top | left | right
      align: 'center', // start | center | end
      display: 'primary', // primary | all | <id de pantalla>
      overTaskbar: false,
      margin: 10,
      idle: 'compact', // normal | compact | mini | hidden
      windows: 'reserve', // reserve | dodge | top: qué hace con las ventanas abiertas
      showDelay: 120,
      hideDelay: 450,
    },
    behavior: {
      openStacksOn: 'click', // click | hover
      launchAtLogin: true,
      locked: false,
      webSearch: 'google',
      suggestions: true,
      fileSearch: true,
      hideInFullscreen: true,
      focusRunning: true,
    },
    hotkeys: {
      search: 'Alt+Space',
      toggleDock: 'Control+Alt+D',
      organize: '',
      workspaces: true,
    },
    clipboard: { enabled: true, max: 40, persist: false },
    clock: { hour12: false, seconds: false },
    monitor: { gadget: true, onTop: false, opacity: 0.96, bounds: null },
    workspaces: [],
    activeWorkspace: null,
    shelf: [],
    notes: [],
    organizer: { mode: 'container', containerName: 'Organizado', includeShortcuts: false, includeFolders: false, byMonth: false, rules: [] },
    customIcons: [],
    stackSeen: {},
  };
}

function findApp(apps, re) {
  return apps.find((a) => re.test(a.name));
}

function appItem(a, name) {
  if (!a) return null;
  return { id: id(), type: 'app', name: name || a.name, appId: a.appId, target: a.path || '' };
}

const sep = () => ({ id: id(), type: 'separator' });
const action = (act, name) => ({ id: id(), type: 'action', action: act, name });
const widget = (w, name) => ({ id: id(), type: 'widget', widget: w, name });
const stack = (name, target, layout = 'grid') => ({ id: id(), type: 'folderStack', name, target, layout, sort: 'date', max: 40 });
const group = (name, items, gradient, layout = 'grid') => ({
  id: id(),
  type: 'group',
  name,
  layout,
  items: items.filter(Boolean),
  icon: { kind: 'auto', gradient },
});

const keyOf = (it) => String(it.appId || it.target || it.name || '').toLowerCase();

// Une zonas con separadores: favoritos | grupos | herramientas.
function zones(...lists) {
  const out = [];
  for (const z of lists.map((l) => l.filter(Boolean))) {
    if (!z.length) continue;
    if (out.length) out.push(sep());
    out.push(...z);
  }
  return out;
}

// Completa grupos con el mismo nombre o agrega grupos nuevos (p. ej. los accesos del escritorio).
// Lo que ya está en la primera zona no se repite dentro de los grupos.
function mergeGroups(groups, extra, favorites = []) {
  const taken = new Set(favorites.flatMap((f) => [keyOf(f), 'n:' + String(f.name || '').toLowerCase()]));
  const free = (it) => !taken.has(keyOf(it)) && !taken.has('n:' + String(it.name || '').toLowerCase());
  const out = groups.map((g) => ({ ...g, items: g.items.filter(free) }));
  for (const e of extra || []) {
    const same = out.find((g) => g.name.toLowerCase() === e.name.toLowerCase());
    const target = same || group(e.name, [], e.gradient);
    const have = new Set(target.items.map(keyOf));
    for (const it of e.items) {
      if (have.has(keyOf(it)) || !free(it)) continue;
      have.add(keyOf(it));
      target.items.push({ ...it, id: id() });
    }
    if (!same && target.items.length) out.push(target);
  }
  return out.filter((g) => g.items.length);
}

function windowsWorkspaces(apps, paths, { favorites = [], desktopGroups = [] } = {}) {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const sys32 = path.join(sysRoot, 'System32');
  const A = (re) => findApp(apps, re);

  const explorer = { id: id(), type: 'app', name: 'Explorador de archivos', target: path.join(sysRoot, 'explorer.exe') };
  const browserApp = A(/google chrome/i) || A(/^microsoft edge$/i) || A(/firefox/i) || A(/brave/i) || A(/^opera/i);
  const browser = () => appItem(browserApp);
  const office = [/^word\b|microsoft word/i, /^excel\b|microsoft excel/i, /^powerpoint\b|microsoft powerpoint/i, /^outlook|microsoft outlook/i, /^onenote|microsoft onenote/i, /teams/i]
    .map(A)
    .filter(Boolean);
  const notepad = A(/^(bloc de notas|notepad)$/i);
  const tools = [
    appItem(A(/^(calculadora|calculator)$/i)),
    appItem(A(/herramienta recortes|recortes|snipping/i)),
    appItem(A(/^paint$/i)),
    appItem(A(/^terminal$|windows terminal/i)),
    { id: id(), type: 'app', name: 'Administrador de tareas', target: path.join(sys32, 'Taskmgr.exe') },
    { id: id(), type: 'app', name: 'Panel de control', target: path.join(sys32, 'control.exe') },
    { id: id(), type: 'app', name: 'Este equipo', target: 'shell:MyComputerFolder' },
    { id: id(), type: 'url', name: 'Configuración de Windows', target: 'ms-settings:' },
  ].filter(Boolean);
  const fun = [/spotify/i, /^steam$/i, /^xbox$/i, /discord/i, /whatsapp/i, /netflix/i, /^(fotos|photos|microsoft fotos)$/i, /reproductor multimedia|media player/i, /^epic games/i]
    .map(A)
    .filter(Boolean)
    .map((a) => appItem(a));

  // Zona 1: lo que más usas según Windows (si no hay datos, solo el Explorador y el navegador).
  const favs = [explorer, browser()].filter(Boolean);
  const seen = new Set(favs.map(keyOf));
  for (const f of favorites) {
    if (favs.length >= 8 || !f || seen.has(keyOf(f))) continue;
    seen.add(keyOf(f));
    favs.push({ ...f, id: id() });
  }

  // Zona 2: grupos por tema, completados con los accesos directos del escritorio.
  const officeGroup = office.length
    ? group('Oficina', [...office.map((a) => appItem(a)), appItem(notepad)], 'indigo')
    : group('Oficina', [appItem(notepad), appItem(A(/^wordpad$/i))], 'indigo');
  const funGroup = fun.length > 1 ? group('Entretenimiento', fun, 'atardecer') : null;
  const groups = mergeGroups([officeGroup, funGroup, group('Utilidades', tools, 'grafito')].filter((g) => g && g.items.length), desktopGroups, favs);

  // Zona 3: carpetas en vivo y herramientas de Lanzadera.
  const principal = zones(favs, groups, [
    stack('Descargas', paths.downloads, 'fan'),
    stack('Documentos', paths.documents, 'grid'),
    { id: id(), type: 'recent', name: 'Recientes', layout: 'list' },
    { id: id(), type: 'shelf', name: 'Estante' },
    widget('clipboard', 'Portapapeles'),
    action('search', 'Buscar'),
    action('workspaces', 'Espacios'),
    action('trash', 'Papelera'),
  ]);

  const trabajo = zones(
    [{ ...explorer, id: id() }, browser(), ...office.map((a) => appItem(a)), appItem(notepad)],
    [stack('Documentos', paths.documents, 'grid'), stack('Escritorio', paths.desktop, 'grid'), { id: id(), type: 'recent', name: 'Recientes', layout: 'list' }],
    [widget('clock', 'Reloj'), widget('notes', 'Notas'), widget('clipboard', 'Portapapeles'), { id: id(), type: 'smart', name: 'Sugeridas', layout: 'grid' }, action('search', 'Buscar'), action('workspaces', 'Espacios')]
  );

  const ocio = zones(
    [browser(), ...fun],
    [stack('Música', paths.music, 'grid'), stack('Videos', paths.videos, 'grid'), stack('Imágenes', paths.pictures, 'grid')],
    [{ id: id(), type: 'smart', name: 'Sugeridas', layout: 'grid' }, action('search', 'Buscar'), action('workspaces', 'Espacios')]
  );

  return [
    { id: id(), name: 'Principal', icon: { glyph: 'house', gradient: 'oceano', fluent: '1f3e0' }, items: principal },
    { id: id(), name: 'Trabajo', icon: { glyph: 'briefcase', gradient: 'violeta', fluent: '1f4bc' }, items: trabajo },
    { id: id(), name: 'Ocio', icon: { glyph: 'gamepad-2', gradient: 'atardecer', fluent: '1f3ae' }, items: ocio },
  ];
}

// Para desarrollo en Linux/macOS: elementos genéricos que existen en cualquier equipo.
function genericWorkspaces(paths) {
  const principal = zones(
    [{ id: id(), type: 'folder', name: 'Carpeta personal', target: paths.home }, { id: id(), type: 'url', name: 'Navegador', target: 'https://www.google.com' }],
    [
      group(
        'Oficina',
        [
          { id: id(), type: 'url', name: 'Word', target: 'https://www.office.com/launch/word' },
          { id: id(), type: 'url', name: 'Excel', target: 'https://www.office.com/launch/excel' },
          { id: id(), type: 'url', name: 'PowerPoint', target: 'https://www.office.com/launch/powerpoint' },
          { id: id(), type: 'url', name: 'Outlook', target: 'https://outlook.live.com' },
          { id: id(), type: 'url', name: 'Bloc de notas', target: 'https://www.google.com/keep' },
        ],
        'indigo'
      ),
      group(
        'Utilidades',
        [
          { id: id(), type: 'url', name: 'Calculadora', target: 'https://www.google.com/search?q=calculadora' },
          { id: id(), type: 'url', name: 'Terminal', target: 'https://example.com' },
          { id: id(), type: 'url', name: 'Configuración', target: 'https://example.com' },
          { id: id(), type: 'url', name: 'Spotify', target: 'https://open.spotify.com' },
        ],
        'grafito'
      ),
    ],
    [
      stack('Descargas', paths.downloads, 'fan'),
      stack('Documentos', paths.documents, 'grid'),
      { id: id(), type: 'recent', name: 'Recientes', layout: 'list' },
      { id: id(), type: 'shelf', name: 'Estante' },
      widget('clipboard', 'Portapapeles'),
      action('search', 'Buscar'),
      action('workspaces', 'Espacios'),
      action('trash', 'Papelera'),
    ]
  );
  return [
    { id: id(), name: 'Principal', icon: { glyph: 'house', gradient: 'oceano', fluent: '1f3e0' }, items: principal },
    { id: id(), name: 'Trabajo', icon: { glyph: 'briefcase', gradient: 'violeta', fluent: '1f4bc' }, items: [widget('clock', 'Reloj'), action('search', 'Buscar'), action('workspaces', 'Espacios')] },
  ];
}

function buildWorkspaces({ apps, paths, platform, favorites, desktopGroups }) {
  return platform === 'win32' ? windowsWorkspaces(apps || [], paths, { favorites, desktopGroups }) : genericWorkspaces(paths);
}

module.exports = { baseConfig, buildWorkspaces, newId: id };
