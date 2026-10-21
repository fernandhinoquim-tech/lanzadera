// Prueba automática: abre todas las vistas, toma capturas y verifica funciones clave.
// Se activa con la variable LANZADERA_SMOKE=<carpeta de salida>.
const { app, BrowserWindow, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describePaths } = require('./describe');
const dockplan = require('./dockplan');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitLoad(win) {
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(700);
}

async function run(ctx) {
  const out = path.resolve(process.env.LANZADERA_SMOKE);
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  const report = { platform: process.platform, release: os.release(), version: app.getVersion(), steps: [], consoleErrors: [] };
  const critical = new Set();

  app.on('web-contents-created', (e, wc) => watchConsole(wc));
  for (const w of BrowserWindow.getAllWindows()) watchConsole(w.webContents);
  function watchConsole(wc) {
    wc.on('console-message', (ev) => {
      const level = ev.level ?? ev.params?.level;
      const message = ev.message ?? ev.params?.message;
      if ((level === 'error' || level === 3) && !/ResizeObserver loop/.test(message)) report.consoleErrors.push(String(message).slice(0, 500));
    });
    wc.on('render-process-gone', (e, d) => report.consoleErrors.push('render-process-gone ' + d.reason));
  }

  const only = process.env.LANZADERA_SMOKE_ONLY ? new RegExp(process.env.LANZADERA_SMOKE_ONLY) : null;
  const step = async (name, fn, isCritical = false) => {
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    console.log('SMOKE paso:', name);
    try {
      const info = await fn();
      report.steps.push({ name, ok: true, ms: Date.now() - t0, info });
    } catch (e) {
      report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.stack || e) });
      if (isCritical) critical.add(name);
    }
  };
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    return img.getSize();
  };
  const dockWin = () => ctx.docks.all()[0];
  const dockEval = (js) => dockWin().webContents.executeJavaScript(js);

  await wait(2500);
  await step('dock-carga', async () => {
    const w = dockWin();
    if (!w) throw new Error('No hay ventana del dock');
    await waitLoad(w);
    await wait(1500);
    const n = await dockEval('document.querySelectorAll(".item").length');
    if (!n) throw new Error('El dock no tiene elementos');
    await shot(w, '01-dock-reposo');
    return { items: n, bounds: w.getBounds() };
  }, true);

  // Elementos que las pruebas necesitan aunque no estén en la barra inicial.
  const ensureItems = (list) => {
    const ws = ctx.store.activeWorkspace();
    const missing = list.filter((n) => !ws.items.some((i) => Object.entries(n).every(([k, v]) => k === 'name' || i[k] === v)));
    if (missing.length) ctx.store.setItems(ws.id, [...ws.items, ...missing]);
    return missing.length;
  };
  await step('barra-inicial', async () => {
    const ws = ctx.store.activeWorkspace();
    return ws.items.map((i) => (i.type === 'separator' ? '|' : i.type === 'group' ? `[${i.name}: ${i.items.map((k) => k.name).join(', ')}]` : i.name || i.type));
  });
  ensureItems([
    { type: 'widget', widget: 'clock', name: 'Reloj' },
    { type: 'widget', widget: 'cpu', name: 'Procesador' },
    { type: 'action', action: 'organize', name: 'Ordenar escritorio' },
  ]);
  await wait(1200);

  const hoverDock = async (frac = 0.5) =>
    dockEval(`(() => { const r = document.querySelector('.dock-bg').getBoundingClientRect(); const v = ['left','right'].includes(window.__lzTest.edge()); const x = v ? r.left + r.width/2 : r.left + r.width*${frac}; const y = v ? r.top + r.height*${frac} : r.top + r.height/2; window.__lzTest.pointer(x, y); return [x,y]; })()`);

  await step('dock-lupa', async () => {
    await hoverDock(0.3);
    await wait(500);
    await hoverDock(0.32);
    await wait(700);
    await shot(dockWin(), '02-dock-lupa');
  });

  const openByType = async (pred, name, wait2 = 900) => {
    await dockEval(`window.__lzTest.open(${JSON.stringify(pred)})`);
    await wait(wait2);
    await shot(dockWin(), name);
    await dockEval('window.__lzTest.close()');
    await wait(250);
  };
  await step('grupo', () => openByType({ type: 'group' }, '03-grupo'));
  await step('abanico-descargas', () => openByType({ type: 'folderStack', layout: 'fan' }, '04-abanico'));
  await step('calendario', () => openByType({ type: 'widget', widget: 'clock' }, '05-calendario'));
  await step('portapapeles', () => openByType({ type: 'widget', widget: 'clipboard' }, '07-portapapeles'));
  await step('espacios', () => openByType({ type: 'action', action: 'workspaces' }, '08-espacios'));
  await step('ordenar-rapido', () => openByType({ type: 'action', action: 'organize' }, '09-ordenar', 1500));
  await step('panel-rendimiento', async () => {
    await dockEval('window.__lzTest.open({ type: "widget", widget: "cpu" })');
    await wait(3500);
    await shot(dockWin(), '09b-rendimiento');
    await dockEval('window.__lzTest.close()');
    await wait(250);
  });
  await step('menu', async () => {
    await dockEval('window.__lzTest.menu()');
    await wait(400);
    await shot(dockWin(), '10-menu');
    await dockEval('window.__lzTest.close()');
  });

  const cfg0 = JSON.parse(JSON.stringify(ctx.store.get()));
  for (const [i, edge] of ['left', 'top', 'right'].entries()) {
    await step('borde-' + edge, async () => {
      ctx.store.patch({ position: { edge, idle: 'normal' } });
      await wait(1400);
      await hoverDock(0.4);
      await wait(700);
      await shot(dockWin(), `11-borde-${i}-${edge}`);
    });
  }
  await step('modo-mini', async () => {
    ctx.store.patch({ position: { edge: 'bottom', idle: 'mini' } });
    await wait(600);
    await dockEval('window.__lzTest.release()');
    await wait(1200);
    await shot(dockWin(), '12-mini');
  });
  await step('estilo-iconos-diseno', async () => {
    ctx.store.patch({ position: { idle: 'normal' }, appearance: { iconMode: 'designed', tileStyle: 'glass' } });
    await wait(1400);
    await shot(dockWin(), '13-diseno-vidrio');
    ctx.store.patch({ appearance: { tileStyle: 'neon', theme: 'light' } });
    await wait(1400);
    await shot(dockWin(), '14-neon-claro');
  });
  await step('al-fondo', async () => {
    ctx.store.patch({ position: { windows: 'desktop', idle: 'normal' } });
    await wait(800);
    const onTop = dockWin().isAlwaysOnTop();
    ctx.docks.onForeground({ desk: 1 });
    await wait(300);
    ctx.store.patch({ position: { windows: 'top' } });
    await wait(600);
    const back = dockWin().isAlwaysOnTop();
    if (onTop) throw new Error('Al fondo, el dock no debería quedar encima de las ventanas');
    if (!back) throw new Error('Al volver a «Siempre encima», el dock no quedó encima');
    return { onTop, back };
  });
  ctx.store.replace(cfg0);
  await wait(800);

  // Monitor de rendimiento
  await step('metricas', async () => {
    ctx.metrics.start();
    await wait(process.platform === 'win32' ? 9000 : 3500);
    const snap = ctx.metrics.snapshot();
    if (!snap) throw new Error('Sin muestras de rendimiento');
    const n = snap.now;
    const info = { cpu: n.cpu, cores: n.cores.length, mem: n.mem, gpu: n.gpu, net: n.net, disk: n.disk, mhz: n.mhz, temps: n.temps, sensors: n.sensors, raw: { gperf: ctx.metrics.win?.gperf, dtemps: ctx.metrics.win?.dtemps }, battery: n.battery, drives: n.drives, procs: n.procs && { count: n.procs.count, top: n.procs.cpu?.slice(0, 3) }, samplerError: ctx.metrics.lastError };
    if (process.platform === 'win32' && !n.net && !n.disk) throw new Error('El recolector de Windows no envió datos: ' + JSON.stringify(info));
    return info;
  });
  await step('monitor-flotante', async () => {
    ctx.store.patch({ monitor: { gadget: true } });
    await wait(3500);
    const w = ctx.monitor.gadget;
    if (!w) throw new Error('No se abrió el monitor flotante');
    await shot(w, '15-monitor-flotante');
    // Detalle al pasar el puntero: uso del procesador y la primera temperatura.
    const hover = (sel) => w.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return !!el; })()`);
    await hover('.gitem[data-k="cpu"]');
    await wait(1200);
    await shot(w, '15b-monitor-detalle-cpu');
    const temp = await hover('.g-temp .gitem');
    await wait(1200);
    await shot(w, '15c-monitor-detalle-temperatura');
    const items = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.gitem')].map((e) => e.dataset.k)`);
    ctx.store.patch({ monitor: { gadget: false } });
    await wait(500);
    return { items, temp };
  });
  await step('monitor-completo', async () => {
    const w = ctx.monitor.openFull();
    await waitLoad(w);
    await wait(3000);
    await shot(w, '16-monitor-completo');
    w.close();
  });

  // Panel de configuración
  const routes = ['/bienvenida', '/inicio', '/elementos', '/accesos', '/novedades', '/temperatura', '/apariencia', '/posicion', '/comportamiento', '/espacios', '/iconos', '/organizador', '/widgets', '/respaldo', '/acerca', '/agregar'];
  for (const r of routes) {
    await step('panel' + r, async () => {
      const w = ctx.panel.open(r);
      await waitLoad(w);
      w.webContents.send('panel:route', r);
      await wait(r === '/iconos' || r === '/agregar' || r === '/accesos' || r === '/novedades' || r === '/temperatura' ? 4000 : 1000);
      await shot(w, '20-panel-' + r.slice(1));
    });
  }
  await step('bienvenida-pasos', async () => {
    const w = ctx.panel.open('/bienvenida');
    await w.webContents.executeJavaScript(`document.querySelectorAll('.modal-back').forEach((m) => m.remove())`);
    w.webContents.send('panel:route', '/bienvenida');
    await wait(800);
    const next = () => w.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.welcome .actions .btn')].pop(); b?.click(); return !!b; })()`);
    for (const [i, name] of ['22-bienvenida-ventanas', '23-bienvenida-accesos'].entries()) {
      await next();
      await wait(i === 1 ? 4000 : 900);
      await shot(w, name);
    }
  });
  await step('panel-editor-icono', async () => {
    const it = ctx.store.activeWorkspace().items.find((i) => i.type === 'app' || i.type === 'url');
    const w = ctx.panel.open('/iconos?id=' + (it?.id || ''));
    w.webContents.send('panel:route', '/iconos?id=' + (it?.id || ''));
    await wait(2000);
    await shot(w, '21-panel-editor-icono');
  });

  // Buscador
  await step('buscador', async () => {
    ctx.search.show('');
    const w = ctx.search.win;
    await waitLoad(w);
    await w.webContents.executeJavaScript(`(() => { const i = document.querySelector('#q'); i.value = 'con'; i.dispatchEvent(new Event('input')); })()`);
    await wait(1500);
    await shot(w, '30-buscador');
    await w.webContents.executeJavaScript(`(() => { const i = document.querySelector('#q'); i.value = '12*(3+4)'; i.dispatchEvent(new Event('input')); })()`);
    await wait(600);
    await shot(w, '31-buscador-calculo');
    ctx.search.hide();
  });

  // Organizador real sobre una carpeta temporal
  await step('organizador', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-org-'));
    const names = ['foto.jpg', 'informe.pdf', 'notas.txt', 'tabla.xlsx', 'cancion.mp3', 'video.mp4', 'archivo.zip', 'raro.xyz', 'Acceso.lnk'];
    const old = new Date(Date.now() - 3600 * 1000);
    for (const n of names) {
      fs.writeFileSync(path.join(dir, n), 'x');
      fs.utimesSync(path.join(dir, n), old, old);
    }
    const plan = await ctx.organizer.plan(dir, { mode: 'container', containerName: 'Organizado' });
    if (plan.moves.length !== 8) throw new Error('Plan inesperado: ' + plan.moves.length);
    const res = await ctx.organizer.apply(plan.id, []);
    if (res.moved !== 8) throw new Error('Movidos: ' + res.moved);
    if (!fs.existsSync(path.join(dir, 'Organizado', 'PDF', 'informe.pdf'))) throw new Error('No se creó PDF/informe.pdf');
    const u = await ctx.organizer.undo(res.id);
    if (u.restored !== 8 || !fs.existsSync(path.join(dir, 'informe.pdf'))) throw new Error('Deshacer falló');
    const left = fs.readdirSync(dir).sort();
    fs.rmSync(dir, { recursive: true, force: true });
    return { categories: plan.categories, afterUndo: left };
  }, true);

  await step('describir-rutas', async () => describePaths([os.homedir(), __filename]));

  // Funciones propias de Windows
  if (process.platform === 'win32') {
    let apps = [];
    await step('apps-windows', async () => {
      apps = await ctx.apps.refresh();
      if (!apps.length) throw new Error('Get-StartApps no devolvió aplicaciones');
      return { count: apps.length, sample: apps.slice(0, 25) };
    });
    const sys = process.env.SystemRoot || 'C:\\Windows';
    const txt = path.join(os.tmpdir(), 'lz-prueba.txt');
    fs.writeFileSync(txt, 'hola');
    const calc = apps.find((a) => /calc/i.test(a.appId));
    const targets = [
      { name: 'explorer', src: path.join(sys, 'explorer.exe') },
      { name: 'notepad', src: path.join(sys, 'System32', 'notepad.exe') },
      { name: 'taskmgr', src: path.join(sys, 'System32', 'Taskmgr.exe') },
      { name: 'control', src: path.join(sys, 'System32', 'control.exe') },
      { name: 'este-equipo', src: 'shell:MyComputerFolder' },
      { name: 'papelera', src: 'shell:RecycleBinFolder' },
      { name: 'texto', src: txt },
      { name: 'carpeta', src: os.homedir() },
      ...apps.slice(0, 6).map((a, i) => ({ name: 'app' + i, app: a.appId, label: a.name })),
      ...(calc ? [{ name: 'calculadora', app: calc.appId }] : []),
    ];
    await step('iconos-windows', async () => {
      const t0 = Date.now();
      const results = await Promise.all(
        targets.map(async (t) => {
          const file = await ctx.icons.get({ app: t.app, src: t.src });
          if (file) fs.copyFileSync(file, path.join(out, 'icons', t.name + '.png'));
          return { ...t, ok: !!file };
        })
      );
      const ok = results.filter((r) => r.ok).length;
      const sizes = {};
      for (const r of results) if (r.ok) sizes[r.name] = require('electron').nativeImage.createFromPath(path.join(out, 'icons', r.name + '.png')).getSize().width;
      if (ok < targets.length / 2) throw new Error(`Solo ${ok} de ${targets.length} iconos`);
      if (!Object.values(sizes).some((w) => w >= 128)) throw new Error('Los iconos no salieron en alta resolución: ' + JSON.stringify({ sizes, error: ctx.icons.lastError }));
      return { ms: Date.now() - t0, results, sizes, error: ctx.icons.lastError };
    });
    await step('ayudante-shell', async () => {
      await wait(1000);
      if (!ctx.shell.alive) throw new Error('El ayudante permanente no está activo: ' + (ctx.shell.lastError || ''));
      if (!ctx.shell.msgIds) throw new Error('El ayudante no respondió: ' + (ctx.shell.lastError || ctx.shell.lastLine));
      return { msgIds: ctx.shell.msgIds, fg: ctx.shell.fg, windows: ctx.shell.windows.length, error: ctx.shell.lastError };
    }, true);
    // Temperatura del procesador: en la CI se abre LibreHardwareMonitor antes de la prueba.
    await step('temperatura-procesador', async () => {
      const seen = [];
      let st = null;
      for (let i = 0; i < 8; i++) {
        st = await ctx.cpuSensors.check();
        seen.push(st.state);
        if (st.state === 'ok') break;
        await wait(2000);
      }
      // Ventana nueva: un paso anterior deja abierto el editor de iconos.
      ctx.panel.win?.destroy();
      const w = ctx.panel.open('/temperatura');
      await waitLoad(w);
      w.webContents.send('panel:route', '/temperatura');
      await wait(3500);
      await shot(w, '21-guia-temperatura');
      return { status: st, seen, sample: ctx.metrics.snapshot()?.now?.cpuTempState };
    });

    const dockState = () => {
      const w = dockWin();
      return { bounds: w.getBounds(), bar: w.lz.bar, reserved: w.lz.reserved, failed: !!w.lz.reserveFailed, dodged: w.lz.dodged, workArea: screen.getPrimaryDisplay().workArea };
    };
    await step('reservar-espacio', async () => {
      ctx.store.patch({ position: { windows: 'top', edge: 'bottom', idle: 'normal', display: 'primary' } });
      await wait(1500);
      const before = screen.getPrimaryDisplay().workArea;
      ctx.store.patch({ position: { windows: 'reserve' } });
      await wait(3000);
      const after = dockState();
      await shot(dockWin(), '40-reservar-espacio');
      ctx.store.patch({ position: { windows: 'top' } });
      await wait(2000);
      const restored = screen.getPrimaryDisplay().workArea;
      if (!after.reserved) throw new Error('Windows no reservó la franja: ' + JSON.stringify({ before, after, error: ctx.shell.lastError }));
      if (after.workArea.height >= before.height) throw new Error('El área de trabajo no se achicó: ' + JSON.stringify({ before, after }));
      if (restored.height !== before.height) throw new Error('No se devolvió el espacio al quitar la reserva: ' + JSON.stringify({ before, restored }));
      return { before, after, restored };
    });

    // Un Bloc de notas maximizado: el dock lo esquiva y lo marca como abierto.
    let notepad = null;
    const notepadExe = path.join(sys, 'System32', 'notepad.exe');
    await step('esquivar-ventanas', async () => {
      ctx.store.patch({ position: { windows: 'dodge' } });
      notepad = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${notepadExe}' -WindowStyle Maximized`], { windowsHide: true });
      await wait(5000);
      const st = dockState();
      await shot(dockWin(), '41-esquivar-ventana');
      const fg = ctx.shell.fg;
      if (!st.dodged) throw new Error('El dock no se escondió con una ventana maximizada encima: ' + JSON.stringify({ st, fg }));
      return { st, fg: fg && { max: fg.max, r: fg.r, own: fg.own } };
    });
    await step('programas-abiertos', async () => {
      ctx.store.patch({ position: { windows: 'top' } });
      ctx.shell.refreshWindows();
      await wait(1200);
      // El Bloc de notas nuevo (de la Tienda) corre desde otra carpeta: se usa la ruta real de su ventana.
      const w = ctx.shell.windows.find((x) => /notepad\.exe$/i.test(x.p || ''));
      const ws = ctx.store.activeWorkspace();
      const item = { id: 'smoke-notepad', type: 'app', name: 'Bloc de notas', target: w?.p || notepadExe };
      ctx.store.setItems(ws.id, [item, ...ws.items.filter((i) => i.id !== item.id)]);
      ctx.shell.refreshWindows();
      await wait(2500);
      const running = ctx.running.ids.includes(item.id);
      await shot(dockWin(), '42-programa-abierto');
      const wins = ctx.running.windowsFor(item).map((w) => ({ h: w.h, p: w.p, m: w.m }));
      const activated = ctx.running.activate(item);
      await wait(1200);
      if (!running) throw new Error('No se marcó el Bloc de notas como abierto: ' + JSON.stringify({ wins, all: ctx.shell.windows.map((w) => w.p) }));
      return { running, wins, activated, fg: ctx.shell.fg && ctx.shell.fg.h };
    });
    spawn('taskkill', ['/IM', 'notepad.exe', '/F'], { windowsHide: true }).on('error', () => {});
    await wait(800);
    await step('mas-usados', async () => {
      const entries = await dockplan.windowsUsage();
      const ranked = dockplan.rankApps(apps, entries);
      return { entries: entries.length, top: ranked.slice(0, 8).map((r) => ({ name: r.app.name, score: Math.round(r.score) })) };
    });
    await step('accesos-escritorio', async () => {
      const res = await dockplan.desktopGroups(ctx.paths);
      return { count: res.count, groups: res.groups.map((g) => [g.name, g.items.map((i) => i.name)]) };
    });
    // Botón en la barra de tareas: cada clic en el icono despliega u oculta la barra.
    // ¿La ventana a está por encima de la ventana b? (recorre el orden de Windows desde a hacia abajo)
    const zAbove = (a, b) =>
      new Promise((resolve) => {
        const ps = `Add-Type -Namespace Lz -Name Z -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);'; $h = [IntPtr]${a}; for ($n = 0; $n -lt 5000 -and $h -ne [IntPtr]::Zero; $n++) { $h = [Lz.Z]::GetWindow($h, 2); if ($h -eq [IntPtr]${b}) { 'si'; exit } }; 'no'`;
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, out) => resolve(String(out || '').trim() === 'si'));
      });
    // La barra al fondo del escritorio y el botón: un clic la trae encima de todo, otro la devuelve atrás.
    await step('boton-barra-tareas', async () => {
      ctx.store.patch({ position: { windows: 'desktop', idle: 'compact', taskbarButton: true } });
      await wait(1500);
      const btn = ctx.taskbarButton.win;
      if (!btn) throw new Error('No se creó el botón de la barra de tareas');
      const dock = dockWin();
      const db = dock.getBounds();
      const cover = new BrowserWindow({ x: db.x, y: db.y - 200, width: db.width, height: db.height + 200, show: false, title: 'Ventana de trabajo' });
      cover.loadURL('data:text/html,<body style="background:%23345">Trabajo</body>');
      cover.show();
      cover.focus();
      await wait(1500);
      const { hwndOf } = require('./shell');
      const [hd, hc] = [hwndOf(dock), hwndOf(cover)];
      const expanded = () => dockEval(`document.getElementById('stage').classList.contains('expanded')`);
      const info = { minimized: btn.isMinimized(), before: await expanded(), aboveBefore: await zAbove(hd, hc) };
      btn.restore();
      await wait(1500);
      info.afterFirstClick = await expanded();
      info.topFirst = dock.isAlwaysOnTop();
      info.aboveFirst = await zAbove(hd, hc);
      await shot(dock, '43-boton-barra-tareas');
      btn.restore();
      await wait(1500);
      info.afterSecondClick = await expanded();
      info.topSecond = dock.isAlwaysOnTop();
      info.visibleSecond = dock.isVisible();
      info.aboveSecond = await zAbove(hd, hc);
      cover.destroy();
      ctx.store.patch({ position: { taskbarButton: false } });
      await wait(800);
      info.removed = !ctx.taskbarButton.win;
      const ok = !info.before && info.afterFirstClick && info.topFirst && info.aboveFirst && !info.afterSecondClick && !info.topSecond && info.visibleSecond && !info.aboveSecond && info.removed;
      if (!ok) throw new Error('El botón no trajo la barra al frente y de vuelta al fondo: ' + JSON.stringify(info));
      return info;
    });
    // Último paso de Windows: al cerrar, el ayudante suelta la franja aunque nadie se lo pida.
    await step('soltar-al-salir', async () => {
      ctx.store.patch({ position: { windows: 'top', idle: 'normal' } });
      await wait(1500);
      const before = screen.getPrimaryDisplay().workArea;
      ctx.store.patch({ position: { windows: 'reserve' } });
      await wait(3000);
      const reserved = screen.getPrimaryDisplay().workArea;
      const t0 = Date.now();
      await ctx.shell.stop();
      const stopMs = Date.now() - t0;
      await wait(2000);
      const after = screen.getPrimaryDisplay().workArea;
      if (reserved.height >= before.height) throw new Error('No se reservó la franja: ' + JSON.stringify({ before, reserved }));
      if (after.height !== before.height) throw new Error('La franja quedó reservada al cerrar el ayudante: ' + JSON.stringify({ before, reserved, after }));
      return { before, reserved, after, stopMs };
    });
    // Cierre brusco: el ayudante muere sin soltar la franja; al volver a abrir, se suelta.
    await step('recuperar-cierre-brusco', async () => {
      const { ShellBridge } = require('./shell');
      ctx.store.patch({ position: { windows: 'top' } });
      ctx.shell.start();
      await wait(5000);
      const before = screen.getPrimaryDisplay().workArea;
      ctx.store.patch({ position: { windows: 'reserve' } });
      await wait(3000);
      const reserved = screen.getPrimaryDisplay().workArea;
      ctx.shell.stopped = true;
      ctx.shell.child?.kill();
      await wait(2500);
      const afterKill = screen.getPrimaryDisplay().workArea;
      const fresh = new ShellBridge({ stateFile: ctx.shell.stateFile });
      fresh.start();
      await wait(6000);
      const recovered = screen.getPrimaryDisplay().workArea;
      await fresh.stop();
      const info = { before, reserved, afterKill, recovered, file: ctx.shell.stateFile };
      if (reserved.height >= before.height) throw new Error('No se reservó la franja: ' + JSON.stringify(info));
      if (recovered.height !== before.height) throw new Error('No se recuperó el espacio tras el cierre brusco: ' + JSON.stringify(info));
      return info;
    });
    await step('miniatura', async () => {
      const t = await ctx.icons.thumbnail(txt, 128);
      return { ok: !!t };
    });
  }

  report.ok = !critical.size && !report.consoleErrors.length;
  report.critical = [...critical];
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('SMOKE', report.ok ? 'OK' : 'FALLÓ', JSON.stringify({ critical: report.critical, consoleErrors: report.consoleErrors.slice(0, 10) }));
  ctx.store.flush();
  ctx.metrics.stop();
  setTimeout(() => app.exit(report.ok ? 0 : 1), 300);
}

module.exports = { run };
