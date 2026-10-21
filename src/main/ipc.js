// Canal de comunicación entre la interfaz y el proceso principal.
const { app, ipcMain, dialog, shell, BrowserWindow, nativeImage, screen } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { launch, showDesktop, lockComputer } = require('./launcher');
const { listFolder, listRecent } = require('./folders');
const { stats } = require('./system');
const { describePaths } = require('./describe');
const dockplan = require('./dockplan');
const { categoryOf } = require('./categories');

const ICON_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];

function uniqueDest(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function register(ctx) {
  const { store, docks, panel, search, icons, apps, organizer, clip, usage, updater, watcher, searchIndex, customDir } = ctx;
  const handle = (ch, fn) =>
    ipcMain.handle(ch, async (e, ...args) => {
      try {
        return await fn(e, ...args);
      } catch (err) {
        return { __error: String(err?.message || err) };
      }
    });

  // Estado y configuración
  handle('state:get', () => ctx.state());
  handle('config:patch', (e, p) => {
    store.patch(p);
    return true;
  });
  handle('items:set', (e, wsId, items) => store.setItems(wsId, items));

  // Abrir elementos
  handle('item:launch', async (e, item, opts = {}) => {
    // Un programa ya abierto vuelve al frente en vez de abrir otra copia (Mayús + clic abre otra).
    const focusRunning = store.get().behavior.focusRunning !== false;
    if (focusRunning && !opts?.newInstance && !opts?.admin && ctx.running?.activate(item, { toggle: !!opts?.toggle })) {
      usage.record(item);
      return true;
    }
    await launch(item, opts || {});
    usage.record(item);
    return true;
  });
  handle('running:get', () => ctx.running?.ids || []);
  handle('item:launchMany', async (e, items) => {
    const errors = [];
    for (const it of items || []) {
      try {
        await launch(it);
        usage.record(it);
      } catch (err) {
        errors.push(`${it.name}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 220));
    }
    return { errors };
  });
  handle('item:reveal', (e, p) => {
    if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p);
    else throw new Error('No se encontró la ubicación');
    return true;
  });
  handle('paths:describe', (e, paths) => describePaths(paths));

  // Carpetas, recientes y archivos
  handle('folder:list', (e, p, opts) => listFolder(p, opts));
  handle('recent:list', () => listRecent(40));
  ipcMain.on('folder:watch', (e, paths) => {
    ctx.watchRequests.set(e.sender.id, Array.isArray(paths) ? paths : []);
    watcher.set([...ctx.watchRequests.values()].flat());
  });
  handle('files:copy', async (e, paths, dir) => {
    let n = 0;
    for (const p of paths || []) {
      const dest = uniqueDest(dir, path.basename(p));
      await fsp.cp(p, dest, { recursive: true, errorOnExist: true, force: false });
      n++;
    }
    return n;
  });
  handle('files:trash', async (e, paths) => {
    for (const p of paths || []) await shell.trashItem(p);
    return true;
  });
  ipcMain.on('drag:start', (e, paths) => {
    const files = (paths || []).filter((p) => typeof p === 'string' && fs.existsSync(p));
    if (!files.length) return;
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'drag.png'));
    e.sender.startDrag({ files, file: files[0], icon });
  });

  // Estante
  handle('shelf:add', (e, paths) => {
    const cur = store.get().shelf;
    const add = (paths || []).filter((p) => typeof p === 'string' && !cur.includes(p));
    store.patch({ shelf: [...add, ...cur].slice(0, 200) });
    return add.length;
  });
  handle('shelf:remove', (e, paths) => {
    store.patch({ shelf: store.get().shelf.filter((p) => !(paths || []).includes(p)) });
    return true;
  });
  handle('shelf:clear', () => {
    store.patch({ shelf: [] });
    return true;
  });
  handle('shelf:transfer', async (e, mode) => {
    const files = store.get().shelf.filter((p) => fs.existsSync(p));
    if (!files.length) return { count: 0 };
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: mode === 'move' ? 'Mover los archivos del estante a…' : 'Copiar los archivos del estante a…', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { count: 0, canceled: true };
    const dir = r.filePaths[0];
    let count = 0;
    for (const p of files) {
      const dest = uniqueDest(dir, path.basename(p));
      if (mode === 'move') {
        try {
          await fsp.rename(p, dest);
        } catch {
          await fsp.cp(p, dest, { recursive: true });
          await fsp.rm(p, { recursive: true, force: true });
        }
      } else {
        await fsp.cp(p, dest, { recursive: true });
      }
      count++;
    }
    if (mode === 'move') store.patch({ shelf: [] });
    shell.openPath(dir);
    return { count, dir };
  });

  // Diálogos
  handle('dialog:pick', async (e, opts = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const props = opts.kind === 'folder' ? ['openDirectory'] : ['openFile'];
    if (opts.multi) props.push('multiSelections');
    const filters =
      opts.kind === 'app'
        ? [{ name: 'Programas', extensions: ['exe', 'lnk', 'bat', 'cmd', 'msc', 'appref-ms'] }, { name: 'Todos los archivos', extensions: ['*'] }]
        : opts.kind === 'image'
          ? [{ name: 'Imágenes', extensions: ICON_EXTS }]
          : undefined;
    const r = await dialog.showOpenDialog(win, { title: opts.title || 'Elegir', properties: props, filters, defaultPath: opts.defaultPath });
    return r.canceled ? [] : r.filePaths;
  });

  // Apps y buscador
  handle('apps:list', (e, refresh) => apps.list({ refresh: !!refresh }));
  handle('search:index', () => searchIndex.build());

  // Organizador
  handle('org:plan', (e, folder, opts) => organizer.plan(folder, { ...store.get().organizer, ...(opts || {}) }));
  handle('org:apply', (e, id, exclude) => organizer.apply(id, exclude));
  handle('org:history', () => organizer.list());
  handle('org:undo', (e, id) => organizer.undo(id));

  // Portapapeles
  handle('clip:list', () => clip.list());
  handle('clip:copy', (e, id) => clip.copy(id));
  handle('clip:pin', (e, id) => clip.pin(id));
  handle('clip:remove', (e, id) => clip.remove(id));
  handle('clip:clear', () => clip.clear());
  handle('clip:pause', (e, v) => clip.setPaused(v));

  // Sistema y sugerencias
  handle('sys:stats', () => stats());
  ipcMain.on('metrics:subscribe', (e, on) => ctx.metrics.subscribe(e.sender, !!on));
  handle('metrics:snapshot', () => ctx.metrics.snapshot());
  ipcMain.on('monitor:resize', (e, height) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed() || w !== ctx.monitor.gadget) return;
    const [width] = w.getSize();
    const h = Math.max(120, Math.min(1200, Math.round(height)));
    if (w.getSize()[1] !== h) w.setSize(width, h);
  });
  handle('stats:suggest', () => usage.suggest(10));

  // Barra en dos zonas, programas más usados y grupos con los accesos del escritorio
  handle('plan:preview', async () => {
    const list = await apps.list().catch(() => []);
    const [used, desk] = await Promise.all([dockplan.mostUsed({ apps: list, usage, n: 6 }), dockplan.desktopGroups(ctx.paths)]);
    return { mostUsed: used, desktop: desk };
  });
  handle('plan:apply', async (e, wsId, opts = {}) => {
    const ws = store.get().workspaces.find((w) => w.id === wsId) || store.activeWorkspace();
    if (!ws) throw new Error('No hay espacio de trabajo');
    let favorites = [];
    let groups = [];
    if (opts.favorites) {
      const list = await apps.list().catch(() => []);
      favorites = (await dockplan.mostUsed({ apps: list, usage, n: 6 })).items;
    }
    if (opts.desktop) groups = (await dockplan.desktopGroups(ctx.paths)).groups;
    const res = dockplan.placeInZones(ws.items, { favorites, groups, arrange: opts.arrange !== false });
    store.setItems(ws.id, res.items);
    return { added: res.added, groups: res.groups };
  });
  handle('items:categorize', (e, items) => (Array.isArray(items) ? items : []).map((it) => categoryOf(it).name));

  // Iconos personalizados
  const importIcons = async (paths) => {
    await fsp.mkdir(customDir, { recursive: true });
    const added = [];
    for (const p of paths || []) {
      const ext = path.extname(p).slice(1).toLowerCase();
      if (!ICON_EXTS.includes(ext)) continue;
      const st = await fsp.stat(p).catch(() => null);
      if (!st || st.size > 8 * 1024 * 1024) continue;
      const file = `${crypto.randomUUID().slice(0, 12)}.${ext}`;
      await fsp.copyFile(p, path.join(customDir, file));
      added.push({ id: file, file, name: path.basename(p, path.extname(p)), added: Date.now() });
    }
    if (added.length) store.patch({ customIcons: [...added, ...store.get().customIcons] });
    return added;
  };
  handle('icons:upload', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Subir iconos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imágenes', extensions: ICON_EXTS }] });
    return r.canceled ? [] : importIcons(r.filePaths);
  });
  handle('icons:import', (e, paths) => importIcons(paths));
  handle('icons:delete', async (e, file) => {
    store.patch({ customIcons: store.get().customIcons.filter((i) => i.file !== file) });
    await fsp.unlink(path.join(customDir, path.basename(file))).catch(() => {});
    return true;
  });
  handle('icons:clearCache', async () => {
    await icons.clear();
    ctx.broadcast('icons:refresh');
    return true;
  });

  // Copias de seguridad
  handle('backup:export', (e) => ctx.backup.exportTo(BrowserWindow.fromWebContents(e.sender)));
  handle('backup:import', (e) => ctx.backup.importFrom(BrowserWindow.fromWebContents(e.sender)));
  handle('app:reset', () => ctx.resetAll());

  // Aplicación
  handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, userData: app.getPath('userData'), updater: updater.state }));
  handle('update:check', () => updater.check(true));
  handle('update:install', () => updater.install());
  handle('hotkeys:status', () => ctx.hotkeyStatus);
  handle('cmd:run', async (e, cmd, arg) => {
    switch (cmd) {
      case 'showDesktop':
        return showDesktop();
      case 'lock':
        return lockComputer();
      case 'toggleDock':
        return ctx.toggleDock();
      case 'monitor':
        ctx.monitor.openFull();
        return true;
      case 'clearShelf':
        return store.patch({ shelf: [] });
      case 'quit':
        return ctx.quit();
      case 'openExternal':
        if (/^https:\/\//.test(arg)) return shell.openExternal(arg);
        return;
      case 'openPath':
        return shell.openPath(String(arg || ''));
      default:
        throw new Error('Comando desconocido');
    }
  });

  // Ventanas
  ipcMain.on('dock:interactive', (e, v) => docks.setInteractive(BrowserWindow.fromWebContents(e.sender), !!v));
  ipcMain.on('dock:bar', (e, info) => docks.setBar(BrowserWindow.fromWebContents(e.sender), info));
  ipcMain.on('dock:raise', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed() && docks.canRaise()) w.moveTop();
  });
  ipcMain.handle('dock:cursor', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w.isDestroyed()) return null;
    const p = screen.getCursorScreenPoint();
    const b = w.getBounds();
    return { x: p.x - b.x, y: p.y - b.y };
  });
  ipcMain.on('dock:focus', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.focus();
  });
  ipcMain.on('panel:open', (e, route) => panel.open(route));
  ipcMain.on('search:open', (e, q) => search.show(q || ''));
  ipcMain.on('search:hide', () => search.hide());
  ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
}

module.exports = { register, describePaths };
