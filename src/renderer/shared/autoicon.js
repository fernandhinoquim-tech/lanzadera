// Elige automáticamente un icono de diseño según el programa, archivo o carpeta.
import { hashGradient } from './tiles.js';
import { basename, extname, normalize, stripExt } from './dom.js';

const APP_RULES = [
  [/excel|libreoffice calc|\bsheets\b|hoja de calculo/, 'sheet', 'esmeralda', '1f4ca'],
  [/powerpoint|impress|presentaci|diapositiva/, 'presentation', 'naranja', '1f4c8'],
  [/\bword\b|wordpad|writer|google docs/, 'file-text', 'indigo', '1f4dd'],
  [/outlook|thunderbird|gmail|\bmail\b|correo/, 'mail', 'oceano', '1f4e7'],
  [/onenote|notion|obsidian|evernote|\bkeep\b|bloc de notas|notepad(?!\+)|\bnotas?\b|sticky/, 'notebook-pen', 'ambar', '1f5d2-fe0f'],
  [/teams|zoom|google meet|skype|webex/, 'video', 'violeta', '1f4f9'],
  [/whatsapp|telegram|signal|messenger|discord|slack|mensaje|\bchat\b/, 'message-circle', 'menta', '1f4ac'],
  [/spotify|music|musica|itunes|deezer|tidal|winamp|groove|foobar|audacity/, 'music', 'rosa', '1f3a7'],
  [/clipchamp|premiere|davinci|capcut|filmora|editor de video|shotcut|kdenlive/, 'film', 'uva', '1f39e-fe0f'],
  [/vlc|video|pelicula|netflix|youtube|prime video|disney|plex|kodi|\bmpc\b|reproductor/, 'clapperboard', 'cereza', '1f4fa'],
  [/steam|epic games|xbox|\bgame|juego|battle\.net|riot|ubisoft|\bea app|\bgog\b|minecraft|roblox|playnite|origin/, 'gamepad-2', 'uva', '1f3ae'],
  [/photoshop|gimp|lightroom|\bfotos\b|\bphotos\b|krita|affinity photo|irfanview|imagen/, 'image', 'atardecer', '1f5bc-fe0f'],
  [/\bpaint\b|illustrator|inkscape|canva|figma|\bdesign|diseno|coreldraw/, 'palette', 'atardecer', '1f3a8'],
  [/notepad\+\+|visual studio|\bvs ?code\b|\bcode\b|intellij|pycharm|webstorm|android studio|sublime|cursor|eclipse|netbeans|arduino/, 'code', 'aurora', '1f4bb'],
  [/terminal|powershell|\bcmd\b|simbolo del sistema|command prompt|\bwsl\b|ubuntu|git bash|putty/, 'square-terminal', 'medianoche', '2328-fe0f'],
  [/chrome|edge|firefox|brave|opera|vivaldi|navegador|browser|safari|\btor\b|arc\b/, 'globe', 'oceano', '1f310'],
  [/calculadora|calculator/, 'calculator', 'grafito', '1f9ee'],
  [/configuracion|settings|ajustes|panel de control|control panel/, 'settings', 'grafito', '2699-fe0f'],
  [/explorador|explorer|file manager|este equipo|this pc|mi pc/, 'folder', 'ambar', '1f4c1'],
  [/calendario|calendar/, 'calendar-days', 'coral', '1f4c5'],
  [/camara|camera|webcam/, 'camera', 'grafito', '1f4f7'],
  [/recortes|snipping|captura|screenshot|sharex|lightshot|greenshot/, 'scissors', 'rosa', '2702-fe0f'],
  [/reloj|\bclock\b|alarma|alarms/, 'alarm-clock', 'indigo', '23f0'],
  [/\bmapas?\b|\bmaps?\b/, 'map', 'esmeralda', '1f5fa-fe0f'],
  [/tienda|\bstore\b|amazon|mercado/, 'shopping-bag', 'oceano', '1f6cd-fe0f'],
  [/tiempo|weather|clima/, 'cloud-sun', 'cielo', '26c5'],
  [/defender|seguridad|security|antivirus|avast|norton|kaspersky|malwarebytes|bitwarden|1password|keepass|contrasen|password/, 'shield-check', 'esmeralda', '1f6e1-fe0f'],
  [/administrador de tareas|task manager|monitor de recursos|resource monitor|process/, 'activity', 'lima', '1f39b-fe0f'],
  [/acrobat|\bpdf|foxit|sumatra/, 'file-text', 'cereza', '1f4d5'],
  [/7-zip|winrar|winzip|peazip|bandizip/, 'file-archive', 'ambar', '1f5dc-fe0f'],
  [/onedrive|dropbox|google drive|icloud|\bmega\b|\bnube\b|cloud/, 'cloud', 'cielo', '2601-fe0f'],
  [/\bobs\b|stream|grabadora|recorder|grabacion/, 'radio', 'cereza', '1f399-fe0f'],
  [/blender|unity|unreal|sketchup|autocad|fusion 360|\b3d\b/, 'box', 'naranja', '1f4e6'],
  [/anydesk|teamviewer|remot|\brdp\b|parsec/, 'monitor-smartphone', 'oceano', '1f5a5-fe0f'],
  [/copilot|chatgpt|claude|gemini|perplexity|\bia\b|\bai\b|asistente|assistant/, 'sparkles', 'aurora', '1f916'],
  [/kindle|\blibro|\bbook|calibre|lector/, 'book-open', 'ambar', '1f4da'],
  [/impresora|printer|\bprint/, 'printer', 'grafito', '1f5a8-fe0f'],
  [/papelera|recycle|trash/, 'trash', 'grafito', '1f5d1-fe0f'],
  [/descargas|downloads|torrent|qbittorrent|jdownloader/, 'download', 'oceano', '1f4e5'],
  [/banco|bank|finanzas|finance|wallet/, 'wallet', 'esmeralda', '1f3e6'],
  [/correo de voz|telefono|phone link|vincular movil|enlace movil/, 'smartphone', 'indigo', '1f4f1'],
];

const FOLDER_RULES = [
  [/descargas|downloads/, 'folder-down', 'oceano', '1f4e5'],
  [/documentos|documents/, 'folder-open', 'indigo', '1f5c2-fe0f'],
  [/imagenes|pictures|fotos|photos|capturas|screenshots/, 'images', 'atardecer', '1f5bc-fe0f'],
  [/musica|music/, 'list-music', 'rosa', '1f3b5'],
  [/videos|peliculas|movies/, 'clapperboard', 'cereza', '1f3ac'],
  [/escritorio|desktop/, 'monitor', 'aurora', '1f5a5-fe0f'],
  [/proyectos|projects|code|codigo|dev|repos/, 'folder-code', 'aurora', '1f4bb'],
  [/trabajo|work|oficina|clientes/, 'briefcase', 'violeta', '1f4bc'],
  [/juegos|games/, 'gamepad-2', 'uva', '1f3ae'],
  [/universidad|escuela|clases|tareas|estudio|school/, 'graduation-cap', 'ambar', '1f393'],
];

// Tipos de archivo por extensión: [glifo, degradado, etiqueta].
export const FILE_TYPES = {
  imagen: { glyph: 'image', gradient: 'atardecer', fluent: '1f5bc-fe0f', exts: 'jpg jpeg png gif bmp webp heic heif tif tiff ico svg raw cr2 nef avif jfif' },
  pdf: { glyph: 'file-text', gradient: 'cereza', fluent: '1f4d5', exts: 'pdf', label: 'PDF' },
  texto: { glyph: 'file-text', gradient: 'indigo', fluent: '1f4c4', exts: 'doc docx odt rtf txt md pages log' },
  hoja: { glyph: 'file-spreadsheet', gradient: 'esmeralda', fluent: '1f4ca', exts: 'xls xlsx xlsm ods csv numbers tsv' },
  presentacion: { glyph: 'presentation', gradient: 'naranja', fluent: '1f4c8', exts: 'ppt pptx odp key pps ppsx' },
  video: { glyph: 'file-video-camera', gradient: 'uva', fluent: '1f39e-fe0f', exts: 'mp4 mkv avi mov wmv webm flv m4v 3gp mpg mpeg' },
  audio: { glyph: 'file-music', gradient: 'rosa', fluent: '1f3b5', exts: 'mp3 wav flac aac ogg m4a wma opus mid midi' },
  comprimido: { glyph: 'file-archive', gradient: 'ambar', fluent: '1f5dc-fe0f', exts: 'zip rar 7z tar gz bz2 xz iso cab' },
  instalador: { glyph: 'package', gradient: 'oceano', fluent: '1f4e6', exts: 'exe msi msix appx appxbundle msixbundle' },
  codigo: { glyph: 'file-code', gradient: 'aurora', fluent: '1f4bb', exts: 'js ts jsx tsx py java c cpp h cs html css json xml php rb go rs sh bat ps1 sql ipynb yml yaml toml' },
  diseno: { glyph: 'pen-tool', gradient: 'violeta', fluent: '1f3a8', exts: 'psd ai xd fig sketch indd cdr afdesign afphoto blend dwg' },
  fuente: { glyph: 'type', gradient: 'grafito', fluent: '1f524', exts: 'ttf otf woff woff2' },
  libro: { glyph: 'book-open', gradient: 'ambar', fluent: '1f4d6', exts: 'epub mobi azw3' },
  acceso: { glyph: 'link', gradient: 'cielo', fluent: '1f517', exts: 'lnk url' },
};

const EXT_MAP = {};
for (const [k, v] of Object.entries(FILE_TYPES)) for (const e of v.exts.split(' ')) EXT_MAP[e] = k;

export function fileTypeOf(path) {
  return EXT_MAP[extname(path)] || null;
}

export const THUMB_EXTS = new Set('jpg jpeg png gif bmp webp heic heif tif tiff avif jfif mp4 mkv avi mov wmv webm m4v pdf psd'.split(' '));

export function monogram(name) {
  const clean = stripExt(basename(name || '?')).replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function autoDesign(item) {
  const name = normalize(item.name || basename(item.target || ''));
  const target = normalize(item.target || item.appId || '');
  switch (item.type) {
    case 'folder': {
      for (const [re, glyph, gradient, fluent] of FOLDER_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient, fluent };
      return { glyph: 'folder', gradient: 'ambar', fluent: '1f4c1' };
    }
    case 'folderStack': {
      for (const [re, glyph, gradient, fluent] of FOLDER_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient, fluent };
      return { glyph: 'folder-open', gradient: 'ambar', fluent: '1f4c2' };
    }
    case 'file': {
      const t = fileTypeOf(item.target || item.name);
      if (t) return { glyph: FILE_TYPES[t].glyph, gradient: FILE_TYPES[t].gradient, fluent: FILE_TYPES[t].fluent };
      return { glyph: 'file', gradient: 'grafito', fluent: '1f4c3' };
    }
    case 'url': {
      let host = '';
      try {
        host = new URL(item.target).hostname.replace(/^www\./, '');
      } catch {}
      for (const [re, glyph, gradient, fluent] of APP_RULES) if (re.test(name) || re.test(host)) return { glyph, gradient, fluent };
      return { text: monogram(item.name || host.split('.')[0] || 'W'), gradient: hashGradient(host || name) };
    }
    case 'group':
      return { glyph: 'layout-grid', gradient: 'aurora', fluent: '1f5c3-fe0f' };
    case 'recent':
      return { glyph: 'clock-arrow-down', gradient: 'indigo', fluent: '1f552' };
    case 'shelf':
      return { glyph: 'inbox', gradient: 'menta', fluent: '1f9fa' };
    case 'smart':
      return { glyph: 'sparkles', gradient: 'aurora', fluent: '2728' };
    case 'separator':
      return { glyph: 'minus', gradient: 'grafito' };
    default: {
      for (const [re, glyph, gradient, fluent] of APP_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient, fluent };
      return { text: monogram(item.name || item.target), gradient: hashGradient(name || target) };
    }
  }
}

export const ACTION_DESIGN = {
  search: { glyph: 'search', gradient: 'indigo', fluent: '1f50d', name: 'Buscar' },
  organize: { glyph: 'wand-sparkles', gradient: 'aurora', fluent: '1fa84', name: 'Ordenar escritorio' },
  settings: { glyph: 'settings', gradient: 'grafito', fluent: '2699-fe0f', name: 'Configuración' },
  workspaces: { glyph: 'layers', gradient: 'violeta', fluent: '1fa9f', name: 'Espacios' },
  trash: { glyph: 'trash', gradient: 'grafito', fluent: '1f5d1-fe0f', name: 'Papelera' },
  showDesktop: { glyph: 'monitor', gradient: 'cielo', fluent: '1f5a5-fe0f', name: 'Mostrar escritorio' },
  apps: { glyph: 'layout-grid', gradient: 'oceano', fluent: '1f9f0', name: 'Todas las apps' },
  monitor: { glyph: 'activity', gradient: 'medianoche', fluent: '1f4c8', name: 'Monitor de rendimiento' },
};

export const WIDGET_DESIGN = {
  clock: { glyph: 'clock', gradient: 'medianoche', fluent: '23f0', name: 'Reloj y calendario' },
  system: { glyph: 'gauge', gradient: 'medianoche', fluent: '1f4c8', name: 'Rendimiento (anillos)' },
  cpu: { glyph: 'cpu', gradient: 'medianoche', fluent: '1f4bb', name: 'Procesador' },
  ram: { glyph: 'memory-stick', gradient: 'medianoche', fluent: '1f4df', name: 'Memoria' },
  gpu: { glyph: 'gpu', gradient: 'medianoche', fluent: '1f3ae', name: 'Tarjeta gráfica' },
  net: { glyph: 'wifi', gradient: 'medianoche', fluent: '1f6dc', name: 'Red' },
  disk: { glyph: 'hard-drive', gradient: 'medianoche', fluent: '1f4be', name: 'Disco' },
  clipboard: { glyph: 'clipboard-list', gradient: 'oceano', fluent: '1f4cb', name: 'Portapapeles' },
  notes: { glyph: 'sticky-note', gradient: 'ambar', fluent: '1f5d2-fe0f', name: 'Notas rápidas' },
};
