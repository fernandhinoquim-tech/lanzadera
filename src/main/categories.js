// Clasifica programas, accesos directos y sitios por tema para armar grupos automáticamente.
const path = require('path');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (list) => new RegExp(` (?:${list.map(esc).join('|')}) `);

// El orden importa: gana la primera categoría que coincide.
const CATEGORIES = [
  {
    name: 'Programación',
    gradient: 'medianoche',
    re: words(['visual studio', 'visual studio code', 'vs code', 'vscode', 'code', 'cursor', 'pycharm', 'intellij', 'intellij idea', 'webstorm', 'phpstorm', 'android studio', 'eclipse', 'netbeans', 'sublime text', 'notepad++', 'atom', 'git', 'git bash', 'github desktop', 'gitkraken', 'sourcetree', 'postman', 'insomnia', 'docker', 'docker desktop', 'anaconda', 'anaconda navigator', 'anaconda prompt', 'anaconda powershell prompt', 'jupyter', 'jupyter notebook', 'spyder', 'python', 'idle', 'node.js', 'powershell', 'windows powershell', 'terminal', 'windows terminal', 'cmd', 'símbolo del sistema', 'command prompt', 'putty', 'filezilla', 'winscp', 'mysql', 'mysql workbench', 'xampp', 'wamp', 'dbeaver', 'heidisql', 'unity', 'unity hub', 'unreal engine', 'godot', 'arduino', 'arduino ide', 'wsl', 'ubuntu']),
  },
  {
    name: 'Estudio y ciencia',
    gradient: 'bosque',
    re: words(['rstudio', 'r', 'spss', 'ibm spss', 'ibm spss statistics', 'stata', 'jamovi', 'jasp', 'minitab', 'matlab', 'mathematica', 'wolfram', 'geogebra', 'zotero', 'mendeley', 'endnote', 'anki', 'originlab', 'origin pro', 'gretl', 'eviews', 'qgis', 'arcgis', 'labview', 'chemdraw', 'imagej', 'fiji', 'mega', 'gephi', 'nvivo', 'atlas.ti', 'maxqda', 'moodle', 'classroom', 'google classroom', 'kahoot', 'duolingo', 'khan academy', 'coursera', 'scholar', 'google scholar', 'pubmed', 'scielo', 'researchgate', 'biorender', 'phet']),
  },
  {
    name: 'Juegos',
    gradient: 'atardecer',
    re: words(['steam', 'epic games', 'epic games launcher', 'xbox', 'ea', 'ea app', 'origin', 'ubisoft', 'ubisoft connect', 'uplay', 'gog', 'gog galaxy', 'battle.net', 'blizzard', 'riot client', 'league of legends', 'valorant', 'minecraft', 'minecraft launcher', 'roblox', 'roblox player', 'fortnite', 'playnite', 'rockstar games launcher', 'genshin impact', 'counter-strike', 'counter-strike 2', 'dota 2', 'overwatch', 'call of duty', 'fifa', 'ea sports fc', 'solitaire', 'solitario', 'microsoft solitaire collection', 'minesweeper', 'buscaminas', 'game', 'games', 'juego', 'juegos', 'gaming', 'nintendo', 'emulator', 'emulador', 'retroarch', 'geforce now', 'twitch']),
  },
  {
    name: 'Comunicación',
    gradient: 'menta',
    re: words(['whatsapp', 'telegram', 'discord', 'zoom', 'zoom workplace', 'teams', 'microsoft teams', 'skype', 'slack', 'messenger', 'signal', 'webex', 'google meet', 'meet', 'thunderbird', 'correo', 'mail', 'gmail', 'hotmail', 'outlook.com', 'outlook (new)', 'phone link', 'vínculo móvil', 'enlace móvil']),
  },
  {
    name: 'Multimedia',
    gradient: 'rosa',
    re: words(['spotify', 'vlc', 'vlc media player', 'itunes', 'apple music', 'music', 'música', 'groove', 'netflix', 'prime video', 'disney+', 'youtube', 'youtube music', 'deezer', 'tidal', 'photos', 'fotos', 'microsoft fotos', 'media player', 'reproductor multimedia', 'windows media player', 'películas y tv', 'movies & tv', 'potplayer', 'kmplayer', 'mpc-hc', 'winamp', 'aimp', 'foobar2000', 'audacity', 'obs', 'obs studio', 'capcut', 'davinci resolve', 'premiere pro', 'adobe premiere pro', 'after effects', 'adobe after effects', 'vegas', 'vegas pro', 'filmora', 'clipchamp', 'handbrake', 'shotcut', 'kdenlive', 'streamlabs', 'plex', 'kodi', 'stremio', 'grabadora de sonidos', 'sound recorder', 'cámara', 'camera']),
  },
  {
    name: 'Diseño',
    gradient: 'violeta',
    re: words(['photoshop', 'adobe photoshop', 'illustrator', 'adobe illustrator', 'indesign', 'adobe indesign', 'lightroom', 'adobe lightroom', 'gimp', 'inkscape', 'krita', 'canva', 'figma', 'blender', 'autocad', 'sketchup', 'coreldraw', 'affinity', 'affinity photo', 'affinity designer', 'paint', 'paint 3d', 'paint.net', 'revit', '3ds max', 'maya', 'cinema 4d', 'solidworks', 'fusion 360', 'freecad', 'adobe xd', 'photopea', 'darktable', 'rawtherapee', 'clip studio paint', 'adobe creative cloud', 'creative cloud', 'designer', 'microsoft designer']),
  },
  {
    name: 'Oficina',
    gradient: 'indigo',
    re: words(['word', 'microsoft word', 'excel', 'microsoft excel', 'powerpoint', 'microsoft powerpoint', 'outlook', 'microsoft outlook', 'onenote', 'microsoft onenote', 'access', 'publisher', 'visio', 'microsoft project', 'acrobat', 'adobe acrobat', 'acrobat reader', 'adobe acrobat reader', 'adobe reader', 'pdf', 'pdf24', 'foxit', 'foxit pdf reader', 'sumatrapdf', 'libreoffice', 'openoffice', 'writer', 'calc', 'impress', 'wps', 'wps office', 'onlyoffice', 'notion', 'obsidian', 'evernote', 'bloc de notas', 'notepad', 'wordpad', 'microsoft 365', 'office', 'google docs', 'docs', 'google sheets', 'sheets', 'google slides', 'slides', 'to do', 'microsoft to do', 'trello', 'calendar', 'calendario', 'xmind', 'sticky notes', 'notas rápidas', 'kindle', 'calibre']),
  },
  {
    name: 'Utilidades',
    gradient: 'grafito',
    re: words(['7-zip', '7-zip file manager', 'winrar', 'winzip', 'peazip', 'ccleaner', 'anydesk', 'teamviewer', 'rustdesk', 'everything', 'powertoys', 'calculadora', 'calculator', 'recortes', 'herramienta recortes', 'snipping tool', 'panel de control', 'control panel', 'configuración', 'configuración de windows', 'settings', 'administrador de tareas', 'task manager', 'explorador de archivos', 'file explorer', 'este equipo', 'this pc', 'papelera', 'papelera de reciclaje', 'recycle bin', 'microsoft store', 'store', 'nvidia', 'nvidia app', 'geforce experience', 'amd software', 'radeon', 'intel', 'logitech', 'logi options+', 'g hub', 'logitech g hub', 'razer synapse', 'icue', 'msi afterburner', 'msi center', 'armoury crate', 'hp smart', 'lenovo vantage', 'myasus', 'antivirus', 'avast', 'avg', 'kaspersky', 'norton', 'mcafee', 'eset', 'bitdefender', 'malwarebytes', 'seguridad de windows', 'windows security', 'driver booster', 'cpu-z', 'gpu-z', 'hwmonitor', 'hwinfo', 'speccy', 'crystaldiskinfo', 'crystaldiskmark', 'rufus', 'balenaetcher', 'onedrive', 'dropbox', 'google drive', 'icloud', 'bitwarden', '1password', 'keepass', 'revo uninstaller', 'sharex', 'greenshot', 'lightshot', 'qbittorrent', 'utorrent', 'internet download manager', 'jdownloader', 'nordvpn', 'protonvpn', 'expressvpn', 'virtualbox', 'vmware', 'vmware workstation', 'lanzadera']),
  },
  {
    name: 'Internet',
    gradient: 'oceano',
    re: words(['chrome', 'google chrome', 'edge', 'microsoft edge', 'firefox', 'mozilla firefox', 'opera', 'opera gx', 'brave', 'vivaldi', 'tor browser', 'internet explorer', 'safari', 'chromium', 'navegador', 'browser', 'google', 'duckduckgo', 'bing']),
  },
];

const FALLBACK = { name: 'Otros', gradient: 'aurora' };
const WEB = { name: 'Sitios web', gradient: 'cielo' };
const FOLDERS = { name: 'Carpetas', gradient: 'ambar' };

function normalize(s) {
  return (
    ' ' +
    String(s || '')
      .toLowerCase()
      .replace(/[_()[\]{}"'«»,;:!?¿¡|/\\]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() +
    ' '
  );
}

// Texto con el que se clasifica un elemento: su nombre, el ejecutable y el sitio web.
function describe(item) {
  const parts = [item.name || ''];
  const t = String(item.target || '');
  if (/^https?:/i.test(t)) {
    try {
      parts.push(new URL(t).hostname.replace(/^www\./, '').split('.').slice(0, -1).join(' '));
    } catch {}
  } else if (t) parts.push(path.win32.basename(t).replace(/\.(exe|lnk|url|appref-ms)$/i, ''));
  if (item.appId) parts.push(String(item.appId).split(/[\\!]/).pop().replace(/\.exe$/i, ''));
  return parts.map(normalize);
}

function categoryOf(item) {
  if (!item) return FALLBACK;
  if (item.type === 'folder') return FOLDERS;
  const texts = describe(item);
  for (const c of CATEGORIES) if (texts.some((t) => c.re.test(t))) return c;
  return item.type === 'url' ? WEB : FALLBACK;
}

function itemKey(it) {
  return String(it.appId || it.target || it.name || '').toLowerCase();
}

// Reparte los elementos en grupos por tema. Los temas con un solo elemento se juntan en «Otros».
function groupByCategory(items, { minSize = 2 } = {}) {
  const buckets = new Map();
  const seen = new Set();
  for (const it of items) {
    const k = itemKey(it);
    const n = String(it.name || '').toLowerCase();
    if (!k || seen.has(k) || seen.has('n:' + n)) continue;
    seen.add(k);
    if (n) seen.add('n:' + n);
    const c = categoryOf(it);
    if (!buckets.has(c.name)) buckets.set(c.name, { ...c, items: [] });
    buckets.get(c.name).items.push(it);
  }
  const order = [...CATEGORIES, WEB, FOLDERS, FALLBACK].map((c) => c.name);
  const groups = [];
  const loose = [];
  for (const name of order) {
    const b = buckets.get(name);
    if (!b) continue;
    if (b.items.length >= minSize && name !== FALLBACK.name) groups.push(b);
    else loose.push(...b.items);
  }
  if (loose.length) groups.push({ ...FALLBACK, name: groups.length ? 'Otros' : 'Mis accesos', items: loose });
  return groups.map(({ name, gradient, items: list }) => ({ name, gradient, items: list }));
}

module.exports = { CATEGORIES, categoryOf, groupByCategory, itemKey };
