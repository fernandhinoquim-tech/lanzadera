// Convierte rutas (archivos, carpetas, accesos directos) en elementos del dock.
const fsp = require('fs').promises;
const path = require('path');

async function describePaths(paths) {
  const out = await Promise.all(
    (paths || []).map(async (p) => {
      if (typeof p !== 'string' || !p) return null;
      let st;
      try {
        st = await fsp.stat(p);
      } catch {
        return null;
      }
      const base = path.basename(p);
      const ext = path.extname(p).toLowerCase();
      const pretty = (s) => s.replace(/\.[^.]+$/, '').replace(/^./, (c) => c.toUpperCase());
      if (st.isDirectory()) return { type: 'folder', name: base || p, target: p };
      if (ext === '.lnk') return { type: 'app', name: base.slice(0, -4), target: p };
      if (ext === '.url') {
        try {
          const m = /^URL=(.+)$/im.exec(await fsp.readFile(p, 'utf8'));
          if (m) return { type: 'url', name: base.slice(0, -4), target: m[1].trim() };
        } catch {}
      }
      if (['.exe', '.bat', '.cmd', '.msc', '.appref-ms', '.com'].includes(ext)) return { type: 'app', name: pretty(base), target: p };
      return { type: 'file', name: base, target: p };
    })
  );
  return out.filter(Boolean);
}

module.exports = { describePaths };
