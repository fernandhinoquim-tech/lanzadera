// Puente permanente con Windows: ventana activa (pantalla completa y esquivar ventanas),
// programas abiertos, reserva del espacio del dock (AppBar) y traer ventanas al frente.
const { screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { isWin, helperPath } = require('./winhelper');

const EDGES = { left: 0, top: 1, right: 2, bottom: 3 };

function hwndOf(win) {
  try {
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
  } catch {
    return '';
  }
}

function toDip(r) {
  if (!r) return null;
  const rect = { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] };
  try {
    return screen.screenToDipRect(null, rect);
  } catch {
    return rect;
  }
}

class ShellBridge extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.restarts = 0;
    this.fullscreenDisplay = null;
    this.fg = null;
    this.lastExternal = null;
    this.windows = [];
    this.msgIds = null;
    this.lastLine = '';
  }

  get alive() {
    return !!this.child;
  }

  start() {
    if (!isWin || this.child) return;
    this.stopped = false;
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      this.child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(), '-Mode', 'shell', '-ParentPid', String(process.pid)], { windowsHide: true });
    } catch {
      this.child = null;
      return;
    }
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.handle(line);
      }
    });
    this.child.stderr.on('data', (d) => (this.lastError = String(d).slice(0, 2000)));
    this.child.stdin.on('error', () => {});
    this.child.on('error', () => {});
    this.child.on('exit', () => {
      this.child = null;
      this.setFullscreen(null);
      this.emit('exit');
      if (!this.stopped && this.restarts++ < 3) setTimeout(() => this.start(), 5000);
    });
  }

  send(cmd) {
    if (this.child?.stdin.writable) this.child.stdin.write(cmd + '\n');
  }

  handle(line) {
    this.lastLine = line;
    const sp = line.indexOf(' ');
    const kind = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    if (kind === 'hello') {
      const [appbar, taskbarCreated] = rest.split(' ').map(Number);
      this.msgIds = { appbar, taskbarCreated };
      this.emit('ready', this.msgIds);
    } else if (kind === 'fg') {
      let fg;
      try {
        fg = JSON.parse(rest);
      } catch {
        return;
      }
      fg.own = fg.pid === process.pid;
      fg.rect = toDip(fg.r);
      this.fg = fg;
      if (!fg.own && !fg.shell && !fg.desk && fg.h) this.lastExternal = fg;
      let full = null;
      if (fg.full && fg.m) full = String(screen.getDisplayMatching(toDip(fg.m)).id);
      if (!fg.own) this.setFullscreen(full);
      this.emit('foreground', fg);
    } else if (kind === 'win') {
      try {
        this.windows = JSON.parse(rest);
      } catch {
        return;
      }
      this.emit('windows', this.windows);
    } else if (kind === 'bar') {
      const [hwnd, r] = rest.split(' ');
      const rect = r && r !== 'fail' ? toDip(r.split(',').map(Number)) : null;
      this.emit('appbar', { hwnd, rect });
    } else if (kind === 'err') {
      this.lastError = rest;
    }
  }

  setFullscreen(displayId) {
    if (this.fullscreenDisplay === displayId) return;
    this.fullscreenDisplay = displayId;
    this.emit('fullscreen', displayId);
  }

  // Reserva una franja de `thickness` píxeles (DIP) junto al borde de la pantalla del dock.
  setAppBar(win, edge, thickness, display, force = false) {
    const hwnd = hwndOf(win);
    if (!hwnd || !this.child) return false;
    let mon = display.bounds;
    try {
      mon = screen.dipToScreenRect(null, display.bounds);
    } catch {}
    const px = Math.max(1, Math.round(thickness * (display.scaleFactor || 1)));
    this.send(`${force ? 'rebar' : 'bar'} ${hwnd} ${EDGES[edge] ?? 3} ${px} ${mon.x} ${mon.y} ${mon.x + mon.width} ${mon.y + mon.height}`);
    return true;
  }

  removeAppBar(win) {
    const hwnd = hwndOf(win);
    if (hwnd) this.send(`unbar ${hwnd}`);
  }

  focus(hwnd) {
    this.send(`focus ${hwnd}`);
  }

  minimize(hwnd) {
    this.send(`min ${hwnd}`);
  }

  refreshWindows() {
    this.send('wins');
  }

  stop() {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    this.send('quit');
    setTimeout(() => child.kill(), 1500).unref?.();
  }
}

module.exports = { ShellBridge, hwndOf };
