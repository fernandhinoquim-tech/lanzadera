// Icono en la bandeja del sistema (junto al reloj de Windows).
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray(ctx) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Lanzadera');

  const build = () => {
    const cfg = ctx.store.get();
    const menu = Menu.buildFromTemplate([
      { label: 'Buscar…', accelerator: cfg.hotkeys.search || undefined, click: () => ctx.search.show() },
      { label: ctx.docks.hidden ? 'Mostrar el dock' : 'Ocultar el dock', click: () => ctx.toggleDock() },
      { label: 'Botón en la barra de tareas', type: 'checkbox', checked: cfg.position.idle === 'taskbar', click: () => ctx.store.patch({ position: { idle: cfg.position.idle === 'taskbar' ? 'normal' : 'taskbar' } }) },
      {
        label: 'Espacio de trabajo',
        submenu: cfg.workspaces.map((w) => ({
          label: w.name,
          type: 'radio',
          checked: w.id === cfg.activeWorkspace,
          click: () => ctx.store.patch({ activeWorkspace: w.id }),
        })),
      },
      {
        label: 'Posición',
        submenu: [
          ['bottom', 'Abajo'],
          ['top', 'Arriba'],
          ['left', 'Izquierda'],
          ['right', 'Derecha'],
        ].map(([edge, label]) => ({ label, type: 'radio', checked: cfg.position.edge === edge, click: () => ctx.store.patch({ position: { edge } }) })),
      },
      { type: 'separator' },
      { label: 'Monitor de rendimiento', click: () => ctx.monitor.openFull() },
      { label: 'Monitor flotante en el escritorio', type: 'checkbox', checked: !!cfg.monitor.gadget, click: () => ctx.store.patch({ monitor: { gadget: !cfg.monitor.gadget } }) },
      { label: 'Ordenar escritorio…', click: () => ctx.panel.open('/organizador') },
      { label: 'Configuración…', click: () => ctx.panel.open('/inicio') },
      { label: 'Buscar actualizaciones', click: () => ctx.updater.check(true) },
      { type: 'separator' },
      { label: 'Salir de Lanzadera', click: () => ctx.quit() },
    ]);
    tray.setContextMenu(menu);
  };

  build();
  tray.on('click', () => ctx.panel.open('/inicio'));
  return { tray, rebuild: build };
}

module.exports = { createTray };
