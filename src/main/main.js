// Lanzadera — proceso principal.
const { app, BrowserWindow, Menu, Notification, nativeTheme, screen, globalShortcut, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');

if (process.env.LANZADERA_USER_DATA) app.setPath('userData', process.env.LANZADERA_USER_DATA);

const { registerSchemes, handleProtocol } = require('./protocol');
const { ConfigStore } = require('./store');
const { buildWorkspaces } = require('./defaults');
const { AppCatalog } = require('./apps');
const { IconService } = require('./icons');
const { Organizer } = require('./organizer');
const { UsageStats } = require('./system');
const { ClipboardHistory } = require('./clipboard');
const { FolderWatcher } = require('./folders');
const { Updater } = require('./updater');
const { SearchIndex } = require('./search');
const { createBackup } = require('./backup');
const { DockManager, PanelWindow, SearchWindow, MonitorWindows, isWin11, supportsMica } = require('./windows');
const { Metrics } = require('./metrics');
const { CpuSensors } = require('./sensors');
const { createTray } = require('./tray');
const { ShellBridge } = require('./shell');
const { RunningTracker } = require('./running');
const dockplan = require('./dockplan');
const { register } = require('./ipc');

registerSchemes();

const ctx = { watchRequests: new Map(), hotkeyStatus: {} };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => ctx.panel?.open('/inicio'));
  app.whenReady().then(init).catch((e) => {
    console.error(e);
    app.exit(1);
  });
}

function knownPaths() {
  const get = (k) => {
    try {
      return app.getPath(k);
    } catch {
      return '';
    }
  };
  return {
    home: get('home'),
    desktop: get('desktop'),
    documents: get('documents'),
    downloads: get('downloads'),
    pictures: get('pictures'),
    music: get('music'),
    videos: get('videos'),
  };
}

function systemAccent() {
  try {
    const a = systemPreferences.getAccentColor?.();
    if (a && /^[\da-f]{6}/i.test(a)) return '#' + a.slice(0, 6);
  } catch {}
  return null;
}

function state() {
  const cfg = ctx.store.get();
  const primary = screen.getPrimaryDisplay();
  return {
    config: cfg,
    env: {
      dark: nativeTheme.shouldUseDarkColors,
      accent: systemAccent(),
      platform: process.platform,
      win11: isWin11(),
      mica: supportsMica(),
      version: app.getVersion(),
      paths: ctx.paths,
      displays: screen.getAllDisplays().map((d, i) => ({
        id: String(d.id),
        label: d.label || `Pantalla ${i + 1}`,
        primary: d.id === primary.id,
        size: `${d.size.width}×${d.size.height}`,
      })),
      hotkeys: ctx.hotkeyStatus,
      updater: ctx.updater.state,
      dockHidden: ctx.docks.hidden,
      packaged: app.isPackaged,
    },
  };
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data);
}

let stateTimer = null;
function pushState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => broadcast('state', state()), 16);
}

let lastHotkeys = '';
function registerHotkeys(force = false) {
  const hk = ctx.store.get().hotkeys;
  const sig = JSON.stringify(hk);
  if (!force && sig === lastHotkeys) return;
  lastHotkeys = sig;
  globalShortcut.unregisterAll();
  const status = {};
  const reg = (name, accel, fn) => {
    if (!accel) return false;
    try {
      status[name] = globalShortcut.register(accel, fn);
    } catch {
      status[name] = false;
    }
    return status[name];
  };
  if (!reg('search', hk.search, () => ctx.search.toggle()) && hk.search === 'Alt+Space') {
    if (reg('search', 'Control+Alt+Space', () => ctx.search.toggle())) status.searchFallback = 'Control+Alt+Space';
  }
  reg('toggleDock', hk.toggleDock, () => toggleDock());
  reg('organize', hk.organize, () => ctx.panel.open('/organizador'));
  if (hk.workspaces) {
    for (let i = 1; i <= 9; i++) {
      reg('ws' + i, `Control+Alt+Shift+${i}`, () => {
        const ws = ctx.store.get().workspaces[i - 1];
        if (ws) ctx.store.patch({ activeWorkspace: ws.id });
      });
    }
  }
  ctx.hotkeyStatus = status;
}

function applyLoginItem() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!ctx.store.get().behavior.launchAtLogin, path: process.execPath });
  } catch {}
}

function toggleDock(force) {
  ctx.docks.toggle(force);
  ctx.tray?.rebuild();
  pushState();
}

function flushAll() {
  ctx.store?.flush();
  ctx.clip?.flush();
  ctx.usage?.flush();
}

function quit() {
  app.isQuitting = true;
  flushAll();
  app.quit();
}

// Antes de salir se devuelve a Windows la franja reservada por el dock; si no, las ventanas
// maximizadas seguirían terminando antes del borde.
let released = false;
async function releaseShell() {
  if (released) return;
  released = true;
  ctx.docks?.releaseAll();
  await ctx.shell?.stop();
}

async function resetAll() {
  await releaseShell();
  const dir = app.getPath('userData');
  ctx.store.writer.flush();
  for (const f of ['config.json', 'config.json.bak', 'stats.json', 'clipboard.json', 'apps-cache.json']) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(dir, 'icon-cache'), { recursive: true, force: true });
  ctx.store.writer = { schedule() {}, flush() {}, pending: () => false };
  app.relaunch();
  app.exit(0);
}

// Versión con novedades que conviene mostrar al actualizar.
const NEWS_VERSION = '1.1.0';

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

async function init() {
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') app.setAppUserModelId('com.lanzadera.app');

  const dir = app.getPath('userData');
  ctx.paths = knownPaths();
  ctx.customDir = path.join(dir, 'custom-icons');
  fs.mkdirSync(ctx.customDir, { recursive: true });

  ctx.store = new ConfigStore(dir);
  ctx.store.load();
  nativeTheme.themeSource = ctx.store.get().appearance.theme;

  ctx.apps = new AppCatalog(dir);
  ctx.icons = new IconService(dir);
  ctx.organizer = new Organizer(dir);
  ctx.usage = new UsageStats(dir);
  ctx.clip = new ClipboardHistory(dir, () => ctx.store.get());
  ctx.watcher = new FolderWatcher();
  ctx.updater = new Updater();
  ctx.searchIndex = new SearchIndex({ store: ctx.store, apps: ctx.apps, paths: ctx.paths });
  ctx.backup = createBackup({ store: ctx.store, customDir: ctx.customDir });
  ctx.shell = new ShellBridge({ stateFile: path.join(dir, 'appbars.json') });
  ctx.running = new RunningTracker(ctx.store, ctx.shell);
  ctx.docks = new DockManager(ctx.store, ctx.shell);
  ctx.panel = new PanelWindow();
  ctx.search = new SearchWindow();
  ctx.cpuSensors = new CpuSensors();
  ctx.metrics = new Metrics({ config: () => ctx.store.get().monitor, cpuReader: () => ctx.cpuSensors.read() });
  ctx.metrics.on('alert', (s) => {
    try {
      if (Notification.isSupported()) new Notification({ title: `Temperatura crítica: ${s.label}`, body: `Llegó a ${s.value} °C (crítico desde ${s.critical} °C). Revisa la ventilación o cierra programas pesados.`, icon: path.join(__dirname, '..', '..', 'assets', 'icon.png') }).show();
    } catch {}
  });
  ctx.monitor = new MonitorWindows(ctx.store);
  ctx.state = state;
  ctx.broadcast = broadcast;
  ctx.toggleDock = toggleDock;
  ctx.quit = quit;
  ctx.resetAll = resetAll;

  handleProtocol({ icons: ctx.icons, customDir: ctx.customDir });
  register(ctx);

  if (!ctx.store.get().workspaces.length) {
    // Primer arranque: favoritos según lo que más usas en Windows y grupos con tus accesos del escritorio.
    const win = process.platform === 'win32';
    const apps = win ? await withTimeout(ctx.apps.refresh(), 25000, []) : [];
    const [used, desk] = win
      ? await Promise.all([withTimeout(dockplan.mostUsed({ apps, usage: ctx.usage }), 20000, { items: [] }), withTimeout(dockplan.desktopGroups(ctx.paths), 15000, { groups: [] })])
      : [{ items: [] }, { groups: [] }];
    const ws = buildWorkspaces({ apps, paths: ctx.paths, platform: process.platform, favorites: used.items, desktopGroups: desk.groups });
    ctx.store.patch({ workspaces: ws, activeWorkspace: ws[0].id });
  } else {
    ctx.apps.list().catch(() => {});
  }

  registerHotkeys(true);
  applyLoginItem();
  ctx.clip.start();
  ctx.updater.init();
  ctx.docks.sync();
  ctx.monitor.sync();
  ctx.tray = createTray(ctx);
  ctx.shell.on('fullscreen', (id) => ctx.docks.setFullscreen(id));
  ctx.shell.on('foreground', (fg) => {
    if (fg.desk) ctx.monitor.raiseOnDesktop();
  });
  ctx.running.on('change', (ids) => broadcast('running', ids));
  ctx.shell.start();

  let lastTheme = ctx.store.get().appearance.theme;
  ctx.store.on('change', (cfg) => {
    if (cfg.appearance.theme !== lastTheme) {
      lastTheme = cfg.appearance.theme;
      nativeTheme.themeSource = lastTheme;
    }
    ctx.docks.sync();
    ctx.docks.setFullscreen(ctx.shell.fullscreenDisplay);
    ctx.monitor.sync();
    ctx.clip.apply();
    registerHotkeys();
    applyLoginItem();
    ctx.tray.rebuild();
    pushState();
  });
  nativeTheme.on('updated', () => {
    ctx.panel.setTheme(nativeTheme.shouldUseDarkColors);
    pushState();
  });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, () => {
      ctx.docks.sync();
      pushState();
    });
  }
  try {
    systemPreferences.on?.('accent-color-changed', pushState);
  } catch {}
  ctx.watcher.on('change', (p) => broadcast('folder:changed', p));
  ctx.clip.on('change', (l) => broadcast('clip:changed', l));
  ctx.updater.on('change', (s) => {
    broadcast('update', s);
    pushState();
  });

  app.on('browser-window-created', (e, win) => {
    const id = win.webContents.id;
    win.webContents.on('destroyed', () => {
      ctx.watchRequests.delete(id);
      ctx.watcher.set([...ctx.watchRequests.values()].flat());
    });
  });

  // Bienvenida en el primer arranque; después de actualizar, las novedades de la versión.
  const cfg = ctx.store.get();
  const version = app.getVersion();
  if (!process.env.LANZADERA_SMOKE) {
    if (cfg.firstRun) ctx.panel.open('/bienvenida');
    else if (cfg.seenVersion !== version) {
      const news = NEWS_VERSION.localeCompare(cfg.seenVersion || '0', undefined, { numeric: true }) > 0;
      ctx.store.patch({ seenVersion: version });
      if (news) ctx.panel.open('/novedades');
    }
  }
  if (process.env.LANZADERA_SMOKE) require('./smoke').run(ctx);
}

app.on('window-all-closed', () => {
  // Lanzadera sigue activa en la bandeja aunque se cierren las ventanas.
});
app.on('before-quit', (e) => {
  flushAll();
  if (released || !ctx.shell?.alive) return;
  e.preventDefault();
  releaseShell().then(() => app.quit());
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  releaseShell();
  ctx.metrics?.stop();
});
