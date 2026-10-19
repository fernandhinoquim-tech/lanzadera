// Widgets del dock: reloj con calendario, rendimiento, portapapeles y notas rápidas.
import { h, esc, timeAgo, uid, debounce } from '../shared/dom.js';
import { tileSVG, gradientColors } from '../shared/tiles.js';
import { seriesMarkup, fmtRateShort, METRIC_COLORS } from '../shared/charts.js';
import { S, api, ap, gl, toast } from './core.js';

const FONT = "'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif";
let sysCache = { cpu: 0, mem: 0 };
export const METRIC_WIDGETS = new Set(['system', 'cpu', 'ram', 'gpu', 'net', 'disk']);

// Mosaico de métrica: nombre, valor grande y gráfica en vivo.
function metricTile(item, a) {
  const m = S.metrics;
  const now = m?.now;
  const hist = m?.hist || {};
  const def = {
    cpu: ['CPU', now ? `${now.cpu}` : '—', '%', [{ values: hist.cpu || [], colors: METRIC_COLORS.cpu }], 100],
    ram: ['RAM', now ? `${now.mem}` : '—', '%', [{ values: hist.mem || [], colors: METRIC_COLORS.mem }], 100],
    gpu: ['GPU', now?.gpu ? `${Math.round(now.gpu.util || 0)}` : '—', now?.gpu ? '%' : '', [{ values: hist.gpu || [], colors: METRIC_COLORS.gpu }], 100],
    net: ['RED', now?.net ? fmtRateShort(now.net.rx) : '—', '', [{ values: hist.rx || [], colors: METRIC_COLORS.rx }, { values: hist.tx || [], colors: METRIC_COLORS.tx, fill: 0.2 }], undefined],
    disk: ['DISCO', now?.disk ? (now.disk.busy != null ? `${Math.round(now.disk.busy)}` : fmtRateShort((now.disk.r || 0) + (now.disk.w || 0))) : '—', now?.disk?.busy != null ? '%' : '', [{ values: hist.dr || [], colors: METRIC_COLORS.dr }, { values: hist.dw || [], colors: METRIC_COLORS.dw, fill: 0.2 }], undefined],
  }[item.widget];
  const [label, value, unit, series, max] = def;
  const color = series[0].colors[0];
  const content =
    seriesMarkup(series, { x0: 4, x1: 96, y0: 58, y1: 92, max, slots: 30, width: 1.6 }) +
    `<text x="13" y="27" font-size="12.5" font-weight="700" letter-spacing="1" fill="${color}" font-family="${FONT}">${label}</text>` +
    `<text x="12" y="52" font-size="${value.length > 4 ? 21 : 27}" font-weight="700" letter-spacing="-.5" fill="currentColor" font-family="${FONT}">${esc(value)}<tspan font-size="14" fill-opacity=".7">${unit}</tspan></text>`;
  return tileSVG({ content, colors: ['#273449', '#0b1120'], style: 'fluent', shape: a.tileShape });
}

export function widgetTile(item) {
  const a = ap();
  const colors = gradientColors(item.icon?.gradient || 'medianoche', item.icon?.colors);
  const style = item.icon?.style || (a.tileStyle === 'minimal' ? 'glass' : a.tileStyle);
  if (item.widget === 'clock') {
    const now = new Date();
    const time = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: !!S.config.clock.hour12 }).replace(/\s?(a|p)\.?\s?m\.?/i, '');
    const day = now.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }).replace('.', '').toUpperCase();
    const content =
      `<text x="50" y="45" text-anchor="middle" font-size="${time.length > 5 ? 26 : 29}" font-weight="650" letter-spacing="-.5" fill="currentColor" font-family="${FONT}">${esc(time)}</text>` +
      `<text x="50" y="70" text-anchor="middle" font-size="14" font-weight="600" letter-spacing="1" fill="currentColor" opacity=".72" font-family="${FONT}">${esc(day)}</text>`;
    return tileSVG({ content, colors, style, shape: a.tileShape });
  }
  if (['cpu', 'ram', 'gpu', 'net', 'disk'].includes(item.widget)) return metricTile(item, a);
  if (item.widget === 'system') {
    if (S.metrics?.now) sysCache = S.metrics.now;
    const ring = (r, pct, color, w) => {
      const c = 2 * Math.PI * r;
      return (
        `<circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="${w}"/>` +
        `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>`
      );
    };
    const content =
      ring(31, sysCache.cpu, '#22d3ee', 7) +
      ring(21, sysCache.mem, '#a78bfa', 7) +
      `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" fill="currentColor" font-family="${FONT}">${sysCache.cpu}</text>`;
    return tileSVG({ content, colors, style, shape: a.tileShape });
  }
  return null;
}

// ---------- Contenido de ventanas emergentes ----------

export function calendarView() {
  const box = h('div.cal');
  let ref = new Date();
  ref.setDate(1);
  const draw = () => {
    const today = new Date();
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const title = cap(ref.toLocaleDateString('es', { month: 'long', year: 'numeric' }));
    const cells = [];
    for (const wd of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) cells.push(`<div class="wd">${wd}</div>`);
    for (let i = 0; i < 42; i++) {
      const d = i - first + 1;
      let cls = 'd';
      let label = d;
      if (d < 1) {
        cls += ' other';
        label = prevDays + d;
      } else if (d > days) {
        cls += ' other';
        label = d - days;
      } else if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cls += ' today';
      cells.push(`<div class="${cls}">${label}</div>`);
      if (i >= 34 && d >= days) break;
    }
    const now = today.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: !!S.config.clock.hour12 });
    const long = cap(today.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    box.innerHTML =
      `<div class="cal-now"><div class="big">${esc(now)}</div><div class="sub">${esc(long)}</div></div>` +
      `<div class="cal-top"><span class="cal-title">${esc(title)}</span>` +
      `<button class="btn icon ghost" data-a="prev" title="Mes anterior">${gl('chevron-left')}</button>` +
      `<button class="btn icon ghost" data-a="today" title="Hoy">${gl('calendar-check')}</button>` +
      `<button class="btn icon ghost" data-a="next" title="Mes siguiente">${gl('chevron-right')}</button></div>` +
      `<div class="cal-grid">${cells.join('')}</div>`;
  };
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'prev') ref.setMonth(ref.getMonth() - 1);
    if (a === 'next') ref.setMonth(ref.getMonth() + 1);
    if (a === 'today') {
      ref = new Date();
      ref.setDate(1);
    }
    if (a) draw();
  });
  draw();
  const t = setInterval(draw, 15000);
  box.cleanup = () => clearInterval(t);
  return box;
}

export function clipboardView(onClose) {
  const box = h('div', { style: { width: '380px' } });
  const search = h('input.searchbox', { type: 'search', placeholder: 'Buscar en el historial…' });
  const list = h('div.list');
  box.append(search, list);
  let data = { items: [], enabled: true, paused: false };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const items = data.items.filter((i) => !q || i.text.toLowerCase().includes(q));
    list.innerHTML = '';
    if (!data.enabled) {
      list.append(h('div.empty', { text: 'El historial está desactivado. Actívalo en Configuración › Widgets.' }));
      return;
    }
    if (!items.length) {
      list.append(h('div.empty', { text: q ? 'Sin resultados' : 'Copia un texto (Ctrl+C) y aparecerá aquí.' }));
      return;
    }
    for (const it of items) {
      const row = h('div.row.clip-item', {
        html:
          `<div class="rtext"><div class="rname">${it.pinned ? `<span class="pinned-mark">${gl('pin')}</span> ` : ''}${esc(it.text.slice(0, 300))}</div><div class="rmeta">${timeAgo(it.ts)} · ${it.text.length} caracteres</div></div>` +
          `<div class="ract"><button class="btn" data-a="pin" title="${it.pinned ? 'Desfijar' : 'Fijar'}">${gl(it.pinned ? 'pin-off' : 'pin')}</button><button class="btn" data-a="del" title="Quitar">${gl('x')}</button></div>`,
      });
      row.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        e.stopPropagation();
        if (a === 'pin') return api.clipPin(it.id);
        if (a === 'del') return api.clipRemove(it.id);
        await api.clipCopy(it.id);
        toast('Copiado al portapapeles');
        onClose?.();
      });
      list.append(row);
    }
  };
  search.addEventListener('input', draw);
  const off = api.onClip((d) => {
    data = d;
    draw();
  });
  api.clipList().then((d) => {
    data = d;
    draw();
  });
  box.cleanup = off;
  box.focusEl = search;
  box.headButtons = () => [
    h('button.btn.ghost', {
      html: gl(data.paused ? 'play' : 'pause'),
      title: data.paused ? 'Reanudar' : 'Pausar',
      class: 'icon',
      onclick: async (e) => {
        await api.clipPause(!data.paused);
        e.currentTarget.innerHTML = gl(!data.paused ? 'play' : 'pause');
      },
    }),
    h('button.btn.ghost', { text: 'Limpiar', onclick: () => api.clipClear() }),
  ];
  box.foot = S.config.clipboard.persist ? 'Los elementos fijados y recientes se guardan en este equipo.' : 'Solo se guarda en memoria: se borra al cerrar Lanzadera (los fijados se conservan).';
  return box;
}

const NOTE_COLORS = { ambar: '#fde68a', rosa: '#fbcfe8', menta: '#a7f3d0', cielo: '#bae6fd', lila: '#ddd6fe', blanco: '#f8fafc' };

export function notesView() {
  const box = h('div.notes');
  let notes = (S.config.notes || []).map((n) => ({ ...n }));
  if (!notes.length) notes = [{ id: uid(), text: '', color: 'ambar', ts: Date.now() }];
  const save = debounce(() => api.patch({ notes }), 400);
  const draw = () => {
    box.innerHTML = '';
    for (const n of notes) {
      const ta = h('textarea', { placeholder: 'Escribe una nota…', spellcheck: 'true' });
      ta.value = n.text;
      ta.addEventListener('input', () => {
        n.text = ta.value;
        n.ts = Date.now();
        save();
      });
      const tools = h('div.ntools');
      for (const [k, c] of Object.entries(NOTE_COLORS)) {
        tools.append(
          h('span.sw', {
            style: { background: c },
            title: k,
            onclick: () => {
              n.color = k;
              save();
              draw();
            },
          })
        );
      }
      tools.append(
        h('button.btn', {
          html: gl('copy'),
          title: 'Copiar',
          onclick: () => navigator.clipboard?.writeText(n.text).then(() => toast('Nota copiada')),
        }),
        h('button.btn', {
          html: gl('trash'),
          title: 'Borrar nota',
          onclick: () => {
            notes = notes.filter((x) => x !== n);
            if (!notes.length) notes = [{ id: uid(), text: '', color: 'ambar', ts: Date.now() }];
            save();
            draw();
          },
        })
      );
      box.append(h('div.note', { style: { background: NOTE_COLORS[n.color] || NOTE_COLORS.ambar } }, ta, tools));
    }
    box.focusEl = box.querySelector('textarea');
  };
  draw();
  box.headButtons = () => [
    h('button.btn.ghost', {
      html: gl('plus') + ' Nueva',
      onclick: () => {
        notes.unshift({ id: uid(), text: '', color: Object.keys(NOTE_COLORS)[notes.length % 6], ts: Date.now() });
        save();
        draw();
        box.querySelector('textarea')?.focus();
      },
    }),
  ];
  box.cleanup = () => save();
  return box;
}
