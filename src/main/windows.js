// Ventanas: el dock (una por pantalla), el panel de configuración y el buscador rápido.
const { BrowserWindow, screen, nativeTheme } = require('electron');
const os = require('os');
const path = require('path');
const { hwndOf } = require('./shell');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const APP_URL = 'lanz://app';

function webPrefs(extra = {}) {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    backgroundThrottling: false,
    ...extra,
  };
}

function winBuild() {
  return process.platform === 'win32' ? Number(os.release().split('.')[2] || 0) : 0;
}

function isWin11() {
  return winBuild() >= 22000;
}

// El material Mica de Electron necesita Windows 11 22H2 (compilación 22621).
function supportsMica() {
  return winBuild() >= 22621;
}

function hardenWebContents(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL)) e.preventDefault();
  });
}

// Área donde vive el dock: el área de trabajo más la franja que el propio dock reservó
// (al reservarla, Windows la descuenta del área de trabajo).
function dockArea(display, pos, reserved) {
  if (pos.overTaskbar) return display.bounds;
  const wa = display.workArea;
  const r = reserved && reserved.edge === pos.edge ? reserved : null;
  if (!r) return wa;
  const right = (a) => a.x + a.width;
  const bottom = (a) => a.y + a.height;
  if (pos.edge === 'bottom') return { x: wa.x, y: wa.y, width: wa.width, height: Math.max(bottom(wa), bottom(r)) - wa.y };
  if (pos.edge === 'top') {
    const top = Math.min(wa.y, r.y);
    return { x: wa.x, y: top, width: wa.width, height: bottom(wa) - top };
  }
  if (pos.edge === 'left') {
    const left = Math.min(wa.x, r.x);
    return { x: left, y: wa.y, width: right(wa) - left, height: wa.height };
  }
  return { x: wa.x, y: wa.y, width: Math.max(right(wa), right(r)) - wa.x, height: wa.height };
}

function dockBounds(display, pos, reserved = null) {
  const area = dockArea(display, pos, reserved);
  const vertical = pos.edge === 'left' || pos.edge === 'right';
  if (vertical) {
    const T = Math.round(Math.min(680, area.width * 0.6));
    return { x: pos.edge === 'left' ? area.x : area.x + area.width - T, y: area.y, width: T, height: area.height };
  }
  const T = Math.round(Math.min(620, area.height * 0.78));
  return { x: area.x, y: pos.edge === 'top' ? area.y : area.y + area.height - T, width: area.width, height: T };
}

function intersects(a, b, inset = 0) {
  return a.x + inset < b.x + b.width && b.x < a.x + a.width - inset && a.y + inset < b.y + b.height && b.y < a.y + a.height - inset;
}

// Con ventanas abiertas, el dock puede: reservar su franja (las ventanas maximizadas terminan
// antes), esconderse cuando la ventana activa lo toca, quedar encima de todo o quedar al fondo,
// en el escritorio, detrás de las ventanas.
class DockManager {
  constructor(store, shell = null) {
    this.store = store;
    this.shell = shell;
    this.wins = new Map();
    this.hidden = false;
    this.fullscreenDisplay = null;
    this.quietUntil = 0;
    this.summoned = false;
    this.lastBlurHide = 0;
    if (shell) {
      shell.on('appbar', (e) => this.onAppBar(e));
      shell.on('foreground', (fg) => this.onForeground(fg));
      shell.on('ready', () => {
        for (const w of this.all()) {
          this.hook(w);
          if (w.lz.reserveKey) w.lz.reserveKey = null;
        }
        this.applyWindowsMode();
      });
      // Si el ayudante se reinicia, Windows puede seguir reservando la franja: se recuerda para
      // volver a pedirla o soltarla cuando el ayudante esté listo otra vez.
      shell.on('exit', () => {
        for (const w of this.all()) w.lz.reserveKey = null;
      });
    }
  }

  windowsMode() {
    const m = this.store.get().position.windows;
    if (m === 'desktop') return 'desktop';
    if (process.platform !== 'win32' || !this.shell) return 'top';
    return m;
  }

  // Un programa en pantalla completa esconde el dock de esa pantalla.
  setFullscreen(displayId) {
    this.fullscreenDisplay = this.store.get().behavior.hideInFullscreen ? displayId : null;
    this.applyVisibility();
  }

  applyVisibility() {
    for (const [id, w] of this.wins) {
      if (w.isDestroyed()) continue;
      const show = !this.hidden && id !== this.fullscreenDisplay;
      if (show && !w.isVisible()) w.showInactive();
      if (!show && w.isVisible()) w.hide();
    }
  }

  targetDisplays() {
    const pos = this.store.get().position;
    const all = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    if (pos.display === 'all') return all;
    if (pos.display === 'primary') return [primary];
    return [all.find((d) => String(d.id) === String(pos.display)) || primary];
  }

  sync() {
    const displays = this.targetDisplays();
    const ids = new Set(displays.map((d) => String(d.id)));
    for (const [id, win] of this.wins) {
      if (!ids.has(id)) {
        this.unreserve(win);
        win.destroy();
        this.wins.delete(id);
      }
    }
    for (const d of displays) {
      const id = String(d.id);
      let win = this.wins.get(id);
      if (!win || win.isDestroyed()) {
        win = this.create(d);
        this.wins.set(id, win);
      }
      win.displayId = id;
      this.place(win, d);
    }
    this.applyWindowsMode();
  }

  place(win, display = this.displayOf(win)) {
    if (!display || win.isDestroyed()) return;
    const b = dockBounds(display, this.store.get().position, win.lz.reserved);
    const cur = win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) win.setBounds(b);
  }

  displayOf(win) {
    return screen.getAllDisplays().find((d) => String(d.id) === win.displayId) || null;
  }

  create(display) {
    const b = dockBounds(display, this.store.get().position);
    const win = new BrowserWindow({
      ...b,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'Lanzadera',
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: webPrefs(),
    });
    win.lz = { bar: null, reserved: null, reserveKey: null, dodged: false, topmost: true };
    win.displayId = String(display.id);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces?.(true);
    hardenWebContents(win.webContents);
    win.loadURL(`${APP_URL}/dock/index.html`);
    win.once('ready-to-show', () => {
      if (!this.hidden && win.displayId !== this.fullscreenDisplay) win.showInactive();
    });
    win.webContents.on('did-finish-load', () => {
      if (win.lz.dodged) win.webContents.send('dock:dodge', true);
      if (this.summoned) win.webContents.send('dock:summon', true);
    });
    // Desplegada con el botón de la barra de tareas: se oculta al hacer clic fuera, como el menú Inicio.
    win.on('blur', () => {
      if (!this.summoned) return;
      this.lastBlurHide = Date.now();
      this.summon(false);
    });
    win.on('closed', () => {
      for (const [id, w] of this.wins) if (w === win) this.wins.delete(id);
    });
    this.hook(win);
    return win;
  }

  // Avisos del shell de Windows: otra barra o la barra de tareas cambiaron de lugar, o el
  // Explorador se reinició y olvidó la franja reservada.
  hook(win) {
    const ids = this.shell?.msgIds;
    if (!ids || win.lz.hooked || process.platform !== 'win32') return;
    win.lz.hooked = true;
    try {
      win.hookWindowMessage(ids.appbar, (wParam) => {
        if (wParam?.readUInt32LE?.(0) !== 1 || Date.now() < this.quietUntil) return;
        clearTimeout(win.lz.reassert);
        win.lz.reassert = setTimeout(() => this.reserve(win, true), 500);
      });
      win.hookWindowMessage(ids.taskbarCreated, () => setTimeout(() => this.reserve(win, true), 1500));
    } catch {}
  }

  applyWindowsMode() {
    const mode = this.windowsMode();
    for (const w of this.all()) {
      const top = mode !== 'desktop';
      if (w.lz.topmost !== top) {
        w.lz.topmost = top;
        w.setAlwaysOnTop(top, 'screen-saver');
      }
      if (mode === 'reserve' && !this.hidden) this.reserve(w);
      else this.unreserve(w);
      if (mode !== 'dodge') this.setDodged(w, false);
    }
    if (mode === 'dodge' && this.shell?.fg) this.onForeground(this.shell.fg);
  }

  // La interfaz del dock informa dónde queda la barra en reposo.
  setBar(win, info) {
    if (!win || win.isDestroyed() || !win.lz || !info) return;
    const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
    win.lz.bar = { thickness: n(info.thickness), rect: { x: n(info.x), y: n(info.y), width: n(info.width), height: n(info.height) } };
    if (this.windowsMode() === 'reserve' && !this.hidden) this.reserve(win);
    else if (this.windowsMode() === 'dodge' && this.shell?.fg) this.onForeground(this.shell.fg);
  }

  reserve(win, force = false) {
    if (!this.shell?.alive || !win?.lz?.bar || win.isDestroyed()) return;
    const pos = this.store.get().position;
    const display = this.displayOf(win);
    if (!display) return;
    const t = win.lz.bar.thickness;
    if (pos.overTaskbar || t <= 0) return this.unreserve(win);
    const key = `${pos.edge}|${t}|${JSON.stringify(display.bounds)}|${display.scaleFactor}`;
    if (!force && key === win.lz.reserveKey) return;
    win.lz.reserveKey = key;
    win.lz.pendingEdge = pos.edge;
    this.quietUntil = Date.now() + 1500;
    this.shell.setAppBar(win, pos.edge, t + 2, display, force);
  }

  // Al soltar la franja, Windows agranda el área de trabajo y el dock se reacomoda solo
  // (evento display-metrics-changed); moverlo antes lo haría saltar.
  unreserve(win) {
    if (!win?.lz || win.isDestroyed() || (!win.lz.reserveKey && !win.lz.reserved)) return;
    this.shell?.removeAppBar(win);
    win.lz.reserveKey = null;
    win.lz.reserved = null;
    if (!this.shell?.alive) this.place(win);
  }

  onAppBar({ hwnd, rect }) {
    const win = this.all().find((w) => hwndOf(w) === hwnd);
    if (!win) return;
    win.lz.reserved = rect ? { ...rect, edge: win.lz.pendingEdge } : null;
    win.lz.reserveFailed = !rect;
    this.place(win);
  }

  onForeground(fg) {
    if (this.windowsMode() === 'desktop' && fg?.desk) return this.raiseOnDesktop();
    if (this.windowsMode() !== 'dodge' || !fg || fg.own || fg.shell) return;
    for (const w of this.all()) {
      let dodge = false;
      const bar = w.lz.bar?.rect;
      if (!fg.desk && !fg.min && fg.rect && bar && bar.width && bar.height) {
        const b = w.getBounds();
        dodge = intersects(fg.rect, { x: b.x + bar.x, y: b.y + bar.y, width: bar.width, height: bar.height }, 8);
      }
      this.setDodged(w, dodge);
    }
  }

  taskbarMode() {
    return this.store.get().position.idle === 'taskbar';
  }

  // Botón en la barra de tareas: despliega la barra encima de todo o la vuelve a ocultar.
  summon(open) {
    this.summoned = !!open;
    for (const w of this.all()) {
      if (open) {
        w.lz.topmost = true;
        w.setAlwaysOnTop(true, 'screen-saver');
        if (!w.isVisible()) w.showInactive();
        w.moveTop();
        w.focus();
      }
      if (!w.webContents.isLoading()) w.webContents.send('dock:summon', !!open);
    }
    if (!open) this.applyWindowsMode();
  }

  // Clic en el botón: si la barra acaba de cerrarse por ese mismo clic (perdió el foco), no se reabre.
  summonToggle() {
    if (this.summoned) this.summon(false);
    else if (Date.now() - this.lastBlurHide > 450) this.summon(true);
  }

  // Al fondo: al ir al escritorio (clic en él o Win + D) el dock vuelve a quedar a la vista,
  // y las ventanas que se abran después lo tapan.
  raiseOnDesktop() {
    for (const w of this.all()) if (w.isVisible()) w.moveTop();
  }

  canRaise() {
    return this.windowsMode() !== 'desktop';
  }

  setDodged(win, v) {
    if (!win.lz || win.lz.dodged === v) return;
    win.lz.dodged = v;
    if (!win.webContents.isLoading()) win.webContents.send('dock:dodge', v);
  }

  all() {
    return [...this.wins.values()].filter((w) => !w.isDestroyed());
  }

  toggle(force) {
    if (this.taskbarMode()) return this.summon(force === undefined ? !this.summoned : !!force);
    this.hidden = force === undefined ? !this.hidden : !force;
    this.applyVisibility();
    this.applyWindowsMode();
  }

  // Quita las franjas reservadas al salir, para devolver el espacio a las ventanas.
  releaseAll() {
    for (const w of this.all()) this.unreserve(w);
  }

  hasReservations() {
    return this.all().some((w) => w.lz.reserved || w.lz.reserveKey);
  }

  setInteractive(win, interactive) {
    if (!win || win.isDestroyed()) return;
    if (interactive) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  }
}

const TASKBAR_APP_ID = 'com.lanzadera.app.barra';

// Icono de Lanzadera en la barra de tareas para el modo «botón»: una ventana mínima, fuera de la
// pantalla y siempre minimizada. Cada clic en su icono la restaura; se avisa y se vuelve a minimizar.
class TaskbarButton {
  constructor({ onClick, shell = null }) {
    this.onClick = onClick;
    this.shell = shell;
    this.win = null;
    this.enabled = false;
  }

  sync(enabled) {
    this.enabled = !!enabled;
    if (enabled && !this.win) this.create();
    else if (!enabled && this.win) {
      const w = this.win;
      this.win = null;
      if (!w.isDestroyed()) w.destroy();
    }
  }

  create() {
    const win = new BrowserWindow({
      x: -32000,
      y: -32000,
      width: 1,
      height: 1,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      hasShadow: false,
      title: 'Lanzadera',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    hardenWebContents(win.webContents);
    // Identidad propia en la barra de tareas: no se agrupa con la ventana de configuración y,
    // al anclarlo, el icono abre Lanzadera con --barra (que despliega la barra si ya está abierta).
    if (process.platform === 'win32') {
      const { app } = require('electron');
      const exe = `"${process.execPath}"` + (app.isPackaged ? '' : ` "${app.getAppPath()}"`);
      try {
        win.setAppDetails({ appId: TASKBAR_APP_ID, appIconPath: process.execPath, appIconIndex: 0, relaunchCommand: `${exe} --barra`, relaunchDisplayName: 'Lanzadera' });
      } catch {}
    }
    // Al restaurarse, esta ventana toma el foco: primero se vuelve a minimizar y recién después se
    // despliega la barra, para que no la cierre al perder el foco.
    win.on('restore', () => {
      if (this.pending) return;
      this.pending = true;
      win.flashFrame(false);
      setTimeout(() => {
        if (!win.isDestroyed()) win.minimize();
        setTimeout(() => {
          this.pending = false;
          this.onClick();
        }, 80);
      }, 0);
    });
    // Si se cierra desde la barra de tareas («Cerrar ventana»), vuelve a aparecer: en este modo
    // es la forma de abrir la barra. No se bloquea el cierre para no frenar el apagado de Windows.
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      setTimeout(() => {
        if (this.enabled && !this.win && !require('electron').app.isQuitting) this.create();
      }, 1500);
    });
    win.showInactive();
    win.minimize();
    this.shell?.noAnimation(win);
    this.win = win;
  }

  // Parpadea en la barra de tareas para que se encuentre al activarlo.
  flash() {
    if (this.win && !this.win.isDestroyed()) this.win.flashFrame(true);
  }
}

class PanelWindow {
  constructor() {
    this.win = null;
  }

  open(route = '') {
    if (this.win && !this.win.isDestroyed()) {
      if (route) this.win.webContents.send('panel:route', route);
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return this.win;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win11 = supportsMica();
    this.win = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 880,
      minHeight: 600,
      show: false,
      title: 'Lanzadera',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      backgroundColor: win11 ? '#00000000' : dark ? '#1c1c1f' : '#f3f3f5',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 },
      backgroundMaterial: win11 ? 'mica' : undefined,
      autoHideMenuBar: true,
      webPreferences: webPrefs(),
    });
    hardenWebContents(this.win.webContents);
    this.win.loadURL(`${APP_URL}/panel/index.html${route ? '#' + route.replace(/^#/, '') : ''}`);
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => (this.win = null));
    return this.win;
  }

  setTheme(dark) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 });
    } catch {}
    if (!supportsMica()) this.win.setBackgroundColor(dark ? '#1c1c1f' : '#f3f3f5');
  }
}

class SearchWindow {
  constructor() {
    this.win = null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 760,
      height: 560,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      title: 'Buscar',
      webPreferences: webPrefs(),
    });
    hardenWebContents(this.win.webContents);
    this.win.loadURL(`${APP_URL}/search/index.html`);
    this.win.on('blur', () => {
      if (this.win && !this.win.webContents.isDevToolsOpened()) this.hide();
    });
    this.win.on('closed', () => (this.win = null));
    return this.win;
  }

  show(query = '') {
    const win = this.ensure();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [w, h] = win.getSize();
    win.setPosition(Math.round(d.workArea.x + (d.workArea.width - w) / 2), Math.round(d.workArea.y + d.workArea.height * 0.16));
    const reveal = () => {
      win.show();
      win.focus();
      win.webContents.send('search:shown', { query });
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal);
    else reveal();
  }

  toggle() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.hide();
    else this.show();
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
      this.win.webContents.send('search:hidden');
    }
  }
}

// Monitor de rendimiento: flotante en el escritorio o en una ventana completa.
class MonitorWindows {
  constructor(store) {
    this.store = store;
    this.gadget = null;
    this.full = null;
    this.saveTimer = null;
  }

  sync() {
    const m = this.store.get().monitor;
    if (m.gadget && (!this.gadget || this.gadget.isDestroyed())) this.createGadget();
    else if (!m.gadget && this.gadget && !this.gadget.isDestroyed()) {
      this.closing = true;
      this.gadget.close();
    }
    if (this.gadget && !this.gadget.isDestroyed()) {
      this.gadget.setAlwaysOnTop(!!m.onTop, 'floating');
      this.gadget.setOpacity(Math.max(0.4, Math.min(1, m.opacity || 1)));
    }
  }

  // Sin «encima de las ventanas», el monitor vive en el escritorio: vuelve a la vista al ir a él.
  raiseOnDesktop() {
    if (this.gadget && !this.gadget.isDestroyed() && !this.store.get().monitor.onTop) this.gadget.moveTop();
  }

  createGadget() {
    const m = this.store.get().monitor;
    const area = screen.getPrimaryDisplay().workArea;
    const w = 330;
    let b = m.bounds;
    const visible = b && screen.getAllDisplays().some((d) => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width - 50 && b.y >= d.workArea.y - 20 && b.y < d.workArea.y + d.workArea.height - 50);
    if (!visible) b = { x: area.x + area.width - w - 24, y: area.y + 24 };
    this.closing = false;
    const win = new BrowserWindow({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: w,
      height: 560,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: !!m.onTop,
      show: false,
      title: 'Monitor de rendimiento',
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: webPrefs(),
    });
    hardenWebContents(win.webContents);
    win.loadURL(`${APP_URL}/monitor/index.html?mode=compact`);
    win.once('ready-to-show', () => win.showInactive());
    win.on('moved', () => {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const { x, y } = win.getBounds();
        this.store.patch({ monitor: { bounds: { x, y } } });
      }, 400);
    });
    win.on('closed', () => {
      this.gadget = null;
      if (!this.closing && this.store.get().monitor.gadget) this.store.patch({ monitor: { gadget: false } });
    });
    this.gadget = win;
  }

  openFull() {
    if (this.full && !this.full.isDestroyed()) {
      this.full.show();
      this.full.focus();
      return this.full;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win11 = supportsMica();
    this.full = new BrowserWindow({
      width: 1060,
      height: 800,
      minWidth: 720,
      minHeight: 560,
      show: false,
      title: 'Monitor de rendimiento',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      backgroundColor: win11 ? '#00000000' : dark ? '#1c1c1f' : '#f3f3f5',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 },
      backgroundMaterial: win11 ? 'mica' : undefined,
      autoHideMenuBar: true,
      webPreferences: webPrefs(),
    });
    hardenWebContents(this.full.webContents);
    this.full.loadURL(`${APP_URL}/monitor/index.html?mode=full`);
    this.full.once('ready-to-show', () => this.full.show());
    this.full.on('closed', () => (this.full = null));
    return this.full;
  }
}

module.exports = { DockManager, PanelWindow, SearchWindow, MonitorWindows, TaskbarButton, isWin11, supportsMica, dockArea, dockBounds, intersects };
