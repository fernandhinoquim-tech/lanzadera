// Programas abiertos: relaciona las ventanas de Windows con los elementos del dock para
// marcarlos con un punto y, al hacer clic, volver a su ventana en vez de abrir otra copia.
const { shell } = require('electron');
const path = require('path');
const { EventEmitter } = require('events');
const { resolveAppPath } = require('./apps');
const { expandEnv } = require('./icons');

const keyCache = new Map();

// Claves con las que una ventana puede pertenecer al elemento: su id de aplicación (AUMID)
// o la ruta del ejecutable.
function itemKeys(item) {
  if (!item || item.type !== 'app') return [];
  const sig = `${item.appId || ''}|${item.target || ''}`;
  if (keyCache.has(sig)) return keyCache.get(sig);
  const keys = new Set();
  const exe = (p) => {
    const t = expandEnv(p || '');
    if (/\.exe$/i.test(t)) keys.add('p:' + path.normalize(t).toLowerCase());
  };
  if (item.appId) {
    keys.add('a:' + item.appId.toLowerCase());
    exe(resolveAppPath(item.appId));
  }
  const target = expandEnv(item.target || '');
  exe(target);
  if (/\.lnk$/i.test(target) && process.platform === 'win32') {
    try {
      const l = shell.readShortcutLink(target);
      if (l.appUserModelId) keys.add('a:' + l.appUserModelId.toLowerCase());
      exe(l.target);
    } catch {}
  }
  const out = [...keys];
  if (keyCache.size > 2000) keyCache.clear();
  keyCache.set(sig, out);
  return out;
}

function windowKeys(w) {
  const keys = [];
  if (w.a) keys.push('a:' + String(w.a).toLowerCase());
  if (w.p) keys.push('p:' + path.normalize(String(w.p)).toLowerCase());
  return keys;
}

// Ventanas (de la más reciente a la más antigua) que pertenecen a cada elemento.
function matchWindows(item, windows) {
  const keys = new Set(itemKeys(item));
  if (!keys.size) return [];
  return windows.filter((w) => windowKeys(w).some((k) => keys.has(k)));
}

class RunningTracker extends EventEmitter {
  constructor(store, bridge) {
    super();
    this.store = store;
    this.bridge = bridge;
    this.ids = [];
    this.sig = '';
    bridge.on('windows', () => this.update());
    bridge.on('exit', () => this.update());
    store.on('change', () => this.update());
  }

  windowsFor(item) {
    return this.bridge.alive ? matchWindows(item, this.bridge.windows || []) : [];
  }

  update() {
    const ids = new Set();
    const wins = this.bridge.alive ? this.bridge.windows || [] : [];
    if (wins.length) {
      for (const ws of this.store.get().workspaces) {
        for (const it of ws.items) {
          if (it.type === 'group') {
            for (const k of it.items || []) {
              if (matchWindows(k, wins).length) {
                ids.add(k.id);
                ids.add(it.id);
              }
            }
          } else if (matchWindows(it, wins).length) ids.add(it.id);
        }
      }
    }
    const list = [...ids].sort();
    const sig = list.join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.ids = list;
    this.emit('change', list);
  }

  // Clic en un programa abierto: lo trae al frente. Desde el dock (toggle), si ya estaba al
  // frente, lo minimiza o pasa a su siguiente ventana si tiene varias.
  activate(item, { toggle = false } = {}) {
    const wins = this.windowsFor(item);
    if (!wins.length) return false;
    const active = String(this.bridge.lastExternal?.h ?? '');
    const idx = toggle ? wins.findIndex((w) => String(w.h) === active && !w.m) : -1;
    if (idx < 0) this.bridge.focus(wins[0].h);
    else if (wins.length > 1) this.bridge.focus(wins[(idx + 1) % wins.length].h);
    else this.bridge.minimize(wins[idx].h);
    setTimeout(() => this.bridge.refreshWindows(), 300);
    return true;
  }
}

module.exports = { RunningTracker, itemKeys, windowKeys, matchWindows };
