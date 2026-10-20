// Gráficas SVG ligeras (área suave con degradado) para el monitor de rendimiento.
let seq = 0;

function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function points(values, { x0, x1, y0, y1, max, slots }) {
  const vals = values.slice(-slots);
  const step = (x1 - x0) / Math.max(1, slots - 1);
  const start = x1 - (vals.length - 1) * step;
  return vals.map((v, i) => [start + i * step, y1 - (Math.max(0, Math.min(v || 0, max)) / max) * (y1 - y0)]);
}

/**
 * Serie(s) como áreas suaves. series: [{ values, colors:[c1,c2] }]
 * box: { x0, x1, y0, y1 } dentro del viewBox; max: tope del eje (auto si se omite).
 */
export function seriesMarkup(series, { x0 = 0, x1 = 100, y0 = 0, y1 = 100, max, slots = 60, width = 2, fillOpacity = 0.42 } = {}) {
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values.slice(-slots))) * 1.15;
  let defs = '';
  let body = '';
  for (const s of series) {
    const id = 'g' + (++seq).toString(36);
    const [c1, c2] = s.colors;
    const pts = points(s.values, { x0, x1, y0, y1, max: top, slots });
    if (!pts.length) continue;
    const line = smoothPath(pts);
    const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${y1}L${pts[0][0].toFixed(1)},${y1}Z`;
    defs += `<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity="${s.fill ?? fillOpacity}"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient><linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    body += `<path d="${area}" fill="url(#${id}a)"/><path d="${line}" fill="none" stroke="url(#${id}l)" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }
  return `<defs>${defs}</defs>${body}`;
}

export function chartSVG(series, { w = 300, h = 90, max, slots = 60, grid = true, width = 2 } = {}) {
  const lines = grid ? [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" stroke="currentColor" stroke-opacity=".08" vector-effect="non-scaling-stroke"/>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${lines}${seriesMarkup(series, { x0: 0, x1: w, y0: 4, y1: h, max, slots, width })}</svg>`;
}

export function ringSVG(pct, colors, { size = 100, stroke = 10, label } = {}) {
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const id = 'r' + (++seq).toString(36);
  const v = Math.max(0, Math.min(100, pct || 0));
  return `<svg viewBox="0 0 ${size} ${size}" class="ring-svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".1" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${((c * v) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dasharray .6s"/>${label ? `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" font-size="${size * 0.22}" font-weight="700" fill="currentColor">${label}</text>` : ''}</svg>`;
}

// ---------- Medidor circular (arco de 240°) ----------

export const ZONE_COLORS = {
  ok: ['#6ee7b7', '#10b981'],
  warn: ['#fde68a', '#f59e0b'],
  crit: ['#fca5a5', '#ef4444'],
};
export const ZONE_TEXT = { ok: 'Normal', warn: 'Cuidado', crit: 'Crítico' };

const A0 = 150;
const SWEEP = 240;

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx, cy, r, d1, d2) {
  if (d2 - d1 < 0.01) d2 = d1 + 0.01;
  const [x1, y1] = polar(cx, cy, r, d1);
  const [x2, y2] = polar(cx, cy, r, d2);
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${r},${r} 0 ${d2 - d1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

/**
 * Medidor tipo velocímetro. Con zones ({ caution, critical }) dibuja la banda verde, amarilla
 * y roja por fuera y colorea el valor según la zona en la que está.
 */
export function gaugeSVG({ value, min = 0, max = 100, colors, zones, text, unit = '', status, statusColor }) {
  const cx = 50;
  const cy = 52;
  const r = 37;
  const id = 'q' + (++seq).toString(36);
  const has = Number.isFinite(value);
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const ang = (v) => A0 + (SWEEP * (clamp(v) - min)) / (max - min);
  const zone = zones && has ? (value >= zones.critical ? 'crit' : value >= zones.caution ? 'warn' : 'ok') : null;
  const [c1, c2] = zone ? ZONE_COLORS[zone] : colors || ['#94a3b8', '#64748b'];
  let band = '';
  if (zones) {
    const rb = 45.5;
    const segs = [
      [min, zones.caution, ZONE_COLORS.ok[1]],
      [zones.caution, zones.critical, ZONE_COLORS.warn[1]],
      [zones.critical, max, ZONE_COLORS.crit[1]],
    ];
    band = segs.map(([a, b, col]) => `<path d="${arcPath(cx, cy, rb, ang(a) + 0.8, ang(b) - 0.8)}" stroke="${col}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/>`).join('');
  }
  const end = has ? ang(value) : A0;
  const [mx, my] = polar(cx, cy, r, end);
  const main = has ? `<path d="${arcPath(cx, cy, r, A0, end)}" stroke="url(#${id})" stroke-width="8" fill="none" stroke-linecap="round" filter="url(#${id}f)"/>` : '';
  const dot = has ? `<circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="5.2" fill="#fff" stroke="${c2}" stroke-width="2.4"/>` : '';
  const label = text ?? (has ? String(Math.round(value)) : '—');
  return (
    `<svg viewBox="0 0 100 92" class="gauge${zone ? ' z-' + zone : ''}" aria-hidden="true">` +
    `<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` +
    `<filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="${c2}" flood-opacity=".55"/></filter></defs>` +
    band +
    `<path d="${arcPath(cx, cy, r, A0, A0 + SWEEP)}" stroke="currentColor" stroke-opacity=".1" stroke-width="8" fill="none" stroke-linecap="round"/>` +
    main +
    dot +
    `<text x="50" y="${status ? 50 : 54}" text-anchor="middle" dominant-baseline="central" class="gv-num">${label}<tspan class="gv-unit" dx="1" dy="-6">${unit}</tspan></text>` +
    (status ? `<text x="50" y="68" text-anchor="middle" class="gv-status" fill="${statusColor || c2}">${status}</text>` : '') +
    `</svg>`
  );
}

export function fmtBytes(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString('es', { maximumFractionDigits: n < 10 && i ? digits : 0 })} ${u[i]}`;
}

export function fmtRate(n) {
  return Number.isFinite(n) ? fmtBytes(n) + '/s' : '—';
}

// Tasa corta para mosaicos: 2,4M · 820K
export function fmtRateShort(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024 * 1024) return (n / 1073741824).toFixed(1).replace('.', ',') + 'G';
  if (n >= 1024 * 1024) return (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1024) return Math.round(n / 1024) + 'K';
  return Math.round(n) + 'B';
}

export const METRIC_COLORS = {
  cpu: ['#22d3ee', '#3b82f6'],
  mem: ['#c084fc', '#7c3aed'],
  gpu: ['#86efac', '#16a34a'],
  rx: ['#fda4af', '#f43f5e'],
  tx: ['#fdba74', '#f59e0b'],
  dr: ['#67e8f9', '#0891b2'],
  dw: ['#f9a8d4', '#db2777'],
};
