// Arma la barra en dos zonas: primero lo que más usas y después tus grupos de accesos
// directos ordenados por tema. Lo demás (carpetas en vivo, estante, herramientas) va al final.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { isWin, runHelper, parseJSON } = require('./winhelper');
const { resolveAppPath } = require('./apps');
const { describePaths } = require('./describe');
const { groupByCategory, itemKey } = require('./categories');
const { newId } = require('./ids');

const LAUNCHABLE = new Set(['app', 'file', 'folder', 'url']);
const SHORTCUT_EXT = /\.(lnk|url|exe|appref-ms)$/i;
const NOT_FAVORITE = /lanzadera|desinstal|uninstall/i;

const sep = () => ({ id: newId(), type: 'separator' });
const withIds = (it) => ({ ...it, id: newId(), ...(it.items ? { items: it.items.map(withIds) } : {}) });

function zonesOf(items) {
  const fav = [];
  const groups = [];
  const rest = [];
  for (const it of items) {
    if (it.type === 'separator') continue;
    if (LAUNCHABLE.has(it.type)) fav.push(it);
    else if (it.type === 'group') groups.push(it);
    else rest.push(it);
  }
  return { fav, groups, rest };
}

function joinZones(...zones) {
  const out = [];
  for (const z of zones) {
    if (!z.length) continue;
    if (out.length) out.push(sep());
    out.push(...z);
  }
  return out;
}

// Ordena la barra: favoritos | grupos | lo demás, separados por líneas.
function arrangeZones(items) {
  const { fav, groups, rest } = zonesOf(items);
  return joinZones(fav, groups, rest);
}

function keysIn(items, deep = false) {
  const keys = new Set();
  for (const it of items) {
    if (LAUNCHABLE.has(it.type)) keys.add(itemKey(it));
    if (deep && it.type === 'group') for (const k of it.items || []) keys.add(itemKey(k));
  }
  return keys;
}

// Agrega favoritos al final de la primera zona y grupos al final de la zona de grupos;
// un grupo con el mismo nombre que uno existente se completa en vez de duplicarse.
function placeInZones(items, { favorites = [], groups = [], arrange = true } = {}) {
  let list = items.map((i) => ({ ...i }));
  const favKeys = keysIn(list.filter((i) => LAUNCHABLE.has(i.type)));
  const newFavs = [];
  for (const f of favorites) {
    const k = itemKey(f);
    if (!k || favKeys.has(k)) continue;
    favKeys.add(k);
    newFavs.push(withIds(f));
  }
  const newGroups = [];
  for (const g of groups) {
    const same = list.find((i) => i.type === 'group' && i.name.toLowerCase() === g.name.toLowerCase());
    if (same) {
      const have = keysIn(same.items || []);
      same.items = [...(same.items || []), ...g.items.filter((k) => !have.has(itemKey(k))).map(withIds)];
    } else if (g.items.length) {
      newGroups.push(withIds({ type: 'group', name: g.name, layout: 'grid', items: g.items, icon: { kind: 'auto', gradient: g.gradient } }));
    }
  }
  if (arrange) {
    const { fav, groups: gs, rest } = zonesOf(list);
    return { items: joinZones([...fav, ...newFavs], [...gs, ...newGroups], rest), added: newFavs.length, groups: newGroups.length };
  }
  // Sin reordenar: los favoritos van tras los primeros elementos lanzables y los grupos tras el último grupo.
  let firstNonFav = list.findIndex((i) => !LAUNCHABLE.has(i.type));
  if (firstNonFav < 0) firstNonFav = list.length;
  list.splice(firstNonFav, 0, ...newFavs);
  if (newGroups.length) {
    let lastGroup = -1;
    list.forEach((i, n) => i.type === 'group' && (lastGroup = n));
    if (lastGroup >= 0) list.splice(lastGroup + 1, 0, ...newGroups);
    else {
      const at = firstNonFav + newFavs.length;
      list.splice(at, 0, ...(at > 0 ? [sep()] : []), ...newGroups, ...(at < list.length ? [sep()] : []));
    }
  }
  return { items: list, added: newFavs.length, groups: newGroups.length };
}

// ---------- Accesos directos del escritorio ----------

function desktopDirs(paths) {
  const dirs = [paths?.desktop];
  if (isWin) dirs.push(path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'));
  return [...new Set(dirs.filter(Boolean))];
}

async function desktopShortcuts(dirs) {
  const files = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) if (SHORTCUT_EXT.test(n) && !/^desktop\.ini$/i.test(n)) files.push(path.join(dir, n));
  }
  return describePaths(files);
}

async function desktopGroups(paths, dirs = desktopDirs(paths)) {
  const items = await desktopShortcuts(dirs);
  return { count: items.length, groups: groupByCategory(items) };
}

// ---------- Programas más usados ----------

// Lee el registro de uso de Windows (UserAssist); devuelve [] si está desactivado.
async function windowsUsage() {
  if (!isWin) return [];
  const res = await runHelper('usage', [], { timeout: 30000 });
  const list = parseJSON(res.stdout);
  return Array.isArray(list) ? list : list ? [list] : [];
}

// Puntúa las apps del menú Inicio según el tiempo de uso y las veces que se abrieron.
function rankApps(apps, entries, now = Date.now()) {
  const byId = new Map();
  const byPath = new Map();
  const byName = new Map();
  for (const a of apps) {
    byId.set(String(a.appId).toLowerCase(), a);
    if (a.path) byPath.set(a.path.toLowerCase(), a);
    byName.set(a.name.toLowerCase(), a);
  }
  const scores = new Map();
  for (const e of entries || []) {
    const id = String(e.id || '');
    if (!id) continue;
    let app = byId.get(id.toLowerCase());
    if (!app) {
      const p = resolveAppPath(id);
      if (p) app = byPath.get(p.toLowerCase());
    }
    if (!app && /\.lnk$/i.test(id)) app = byName.get(path.win32.basename(id, '.lnk').toLowerCase());
    if (!app || NOT_FAVORITE.test(app.name)) continue;
    const days = e.last ? Math.max(0, (now - e.last) / 86400000) : 365;
    const recency = days < 7 ? 1.5 : days < 30 ? 1.15 : days < 120 ? 1 : 0.6;
    const score = (Math.max(0, e.focus || 0) / 60000 + Math.max(0, e.runs || 0) * 4) * recency;
    scores.set(app, (scores.get(app) || 0) + score);
  }
  return [...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([app, score]) => ({ app, score }));
}

async function mostUsed({ apps, usage, n = 6 }) {
  let source = 'none';
  let items = [];
  try {
    const ranked = rankApps(apps || [], await windowsUsage());
    if (ranked.length) {
      source = 'windows';
      items = ranked.slice(0, n).map(({ app }) => ({ type: 'app', name: app.name, appId: app.appId, target: app.path || '' }));
    }
  } catch {}
  if (!items.length && usage) {
    const own = Object.values(usage.data || {})
      .filter((e) => e.item && e.item.type === 'app' && !NOT_FAVORITE.test(e.item.name || ''))
      .sort((a, b) => b.total - a.total)
      .slice(0, n)
      .map((e) => ({ ...e.item }));
    if (own.length) {
      source = 'lanzadera';
      items = own;
    }
  }
  return { source, items };
}

module.exports = { arrangeZones, placeInZones, zonesOf, desktopDirs, desktopShortcuts, desktopGroups, windowsUsage, rankApps, mostUsed };
