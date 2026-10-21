// Monitor de escritorio: medidores de uso, temperaturas con zonas de cuidado y crítico, red y
// disco. Al pasar el puntero sobre un medidor se despliega su detalle.
import { h, esc } from './dom.js';
import { chartSVG, gaugeSVG, fmtBytes, fmtRate, METRIC_COLORS as C, ZONE_COLORS, ZONE_TEXT } from './charts.js';

const TEMP_SLOTS = 90;

// Por qué no aparece la temperatura del procesador y qué paso falta, según lo que detecta
// Lanzadera: off (no hay programa de sensores), noserver (abierto sin servidor web) o
// nosensor (responde, pero sin el controlador PawnIO).
const CPU_HINTS = {
  off: [
    'Cómo verla',
    '<p class="dnote">Windows protege el sensor del procesador: solo lo leen programas con permisos de administrador y un controlador especial. <b>LibreHardwareMonitor</b> (gratis y de código abierto) lo lee y se lo pasa a Lanzadera.</p>' +
      '<ol class="dsteps"><li>Descárgalo y ábrelo.</li><li>Si pregunta por <b>PawnIO</b>, acepta.</li><li>En <b>Options › Remote Web Server</b>, marca <b>Run</b>.</li></ol>',
  ],
  noserver: ['Falta un paso', '<p class="dnote"><b>LibreHardwareMonitor está abierto</b>, pero falta activar su servidor web: en su menú <b>Options › Remote Web Server</b>, marca <b>Run</b> (puerto 8085).</p>'],
  nosensor: ['Falta PawnIO', '<p class="dnote"><b>LibreHardwareMonitor responde</b>, pero no ve el sensor del procesador: falta su controlador <b>PawnIO</b>. Ciérralo, vuelve a abrirlo y acepta instalar PawnIO.</p>'],
};

export const cpuTempHint = (state) => (CPU_HINTS[state] || CPU_HINTS.off)[0];

export function cpuTempHelp(state) {
  return (CPU_HINTS[state] || CPU_HINTS.off)[1] + '<button class="dguide" data-act="cpu-guide">Ver la guía paso a paso</button>';
}

function uptime(s) {
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}

const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('es', { maximumFractionDigits: d }) : '—');
const kv = (k, v) => `<div class="dkv"><span>${esc(k)}</span><b>${v}</b></div>`;
const bar = (p, colors) => `<div class="dbar"><i style="width:${Math.max(0, Math.min(100, p || 0)).toFixed(1)}%;background:linear-gradient(90deg,${colors[0]},${colors[1]})"></i></div>`;

function topList(list, pick, fmt) {
  if (!list?.length) return '';
  return `<div class="dtop">${list
    .slice(0, 3)
    .map((p) => `<div><span>${esc(p[0])}</span><b>${fmt(pick(p))}</b></div>`)
    .join('')}</div>`;
}

// Barra lineal con las tres zonas, la temperatura actual y las extremas de la sesión.
function thermoBar(s, lo, hi) {
  const span = s.max - 20;
  const at = (v) => Math.max(0, Math.min(100, ((v - 20) / span) * 100)).toFixed(1);
  return (
    `<div class="thermo"><div class="tz" style="--a:0%;--b:${at(s.caution)}%;background:${ZONE_COLORS.ok[1]}"></div>` +
    `<div class="tz" style="--a:${at(s.caution)}%;--b:${at(s.critical)}%;background:${ZONE_COLORS.warn[1]}"></div>` +
    `<div class="tz" style="--a:${at(s.critical)}%;--b:100%;background:${ZONE_COLORS.crit[1]}"></div>` +
    (Number.isFinite(lo) ? `<i class="tmm" style="left:${at(lo)}%" title="Mínima"></i><i class="tmm" style="left:${at(hi)}%" title="Máxima"></i>` : '') +
    `<i class="tnow" style="left:${at(s.value)}%"></i></div>` +
    `<div class="tscale"><span>20°</span><span style="left:${at(s.caution)}%">${s.caution}°</span><span style="left:${at(s.critical)}%">${s.critical}°</span><span class="r">${s.max}°</span></div>`
  );
}

export function createGadget({ onCpuGuide } = {}) {
  const root = h('div.gview');
  const usage = h('div.gsec.g-use');
  const useDrawer = h('div.gdrawer', h('div.gdin'));
  const tempHead = h('div.glabel', { html: '<span>Temperaturas</span><span class="glegend"><i class="ok"></i>Normal<i class="warn"></i>Cuidado<i class="crit"></i>Crítico</span>' });
  const temps = h('div.gsec.g-temp');
  const tempDrawer = h('div.gdrawer', h('div.gdin'));
  const io = h('div.gsec.g-io');
  const ioDrawer = h('div.gdrawer', h('div.gdin'));
  root.append(usage, useDrawer, tempHead, temps, tempDrawer, io, ioDrawer);

  const items = new Map();
  const item = (key, parent, row = false) => {
    let it = items.get(key);
    if (it) return it;
    const el = h(`div.gitem${row ? '.grow' : ''}`, { dataset: { k: key } });
    el.innerHTML = row ? '<div class="gri"></div><div class="grt"><b></b><span></span></div><div class="grc"></div>' : '<div class="gviz"></div><b></b><span></span>';
    parent.append(el);
    it = { el, viz: el.querySelector(row ? '.grc' : '.gviz'), title: el.querySelector('b'), sub: el.querySelector('span'), icon: el.querySelector('.gri'), drawer: parent === usage ? useDrawer : parent === temps ? tempDrawer : ioDrawer };
    items.set(key, it);
    return it;
  };

  const tempHist = {};
  const tempRange = {};
  let last = null;
  let openKey = null;
  let hoverTimer = null;
  let closeTimer = null;
  let onAlert = null;

  // ---------- Detalle al pasar el puntero ----------

  function detail(key, { now, hist }) {
    if (key === 'cpu') {
      const ghz = now.mhz ? `${num(now.mhz / 1000, 2)} GHz` : '—';
      return (
        `<div class="dchart">${chartSVG([{ values: hist.cpu, colors: C.cpu }], { max: 100, h: 54 })}</div>` +
        kv('Modelo', esc(now.cpuModel || '—')) +
        kv('Velocidad', ghz) +
        kv('Hilos', now.cores?.length || '—') +
        `<div class="dcores">${(now.cores || []).map((c) => `<i style="--v:${c}%" title="${c} %"></i>`).join('')}</div>` +
        topList(now.procs?.cpu, (p) => p[1], (v) => `${num(v, 1)} %`) +
        kv('Encendido desde hace', uptime(now.uptime || 0))
      );
    }
    if (key === 'mem') {
      return (
        `<div class="dchart">${chartSVG([{ values: hist.mem, colors: C.mem }], { max: 100, h: 54 })}</div>` +
        bar(now.mem, C.mem) +
        kv('En uso', fmtBytes(now.memUsed)) +
        kv('Disponible', fmtBytes(now.memTotal - now.memUsed)) +
        kv('Total', fmtBytes(now.memTotal)) +
        topList(now.procs?.mem, (p) => p[2], (v) => fmtBytes(v))
      );
    }
    if (key === 'gpu') {
      const g = now.gpu;
      if (!g) return '<p class="dnote">Windows no informó el uso de la tarjeta gráfica en este equipo.</p>';
      const vram = g.memTotal ? (g.mem / g.memTotal) * 100 : null;
      return (
        `<div class="dchart">${chartSVG([{ values: hist.gpu, colors: C.gpu }], { max: 100, h: 54 })}</div>` +
        kv('Tarjeta', esc(g.name || '—')) +
        (vram !== null ? bar(vram, C.gpu) + kv('Memoria de video', `${fmtBytes(g.mem)} de ${fmtBytes(g.memTotal)}`) : g.mem ? kv('Memoria de video', fmtBytes(g.mem)) : '') +
        (g.temp != null ? kv('Temperatura', `${Math.round(g.temp)} °C`) : '') +
        (g.fan != null ? kv('Ventilador', `${num(g.fan)} %`) : g.fanRpm ? kv('Ventilador', `${num(g.fanRpm)} rpm`) : '') +
        (g.power != null ? kv('Consumo', `${Math.round(g.power)} W`) : '')
      );
    }
    if (key === 'net') {
      const peak = Math.max(0, ...(hist.rx || []));
      return (
        `<div class="dchart">${chartSVG([{ values: hist.rx, colors: C.rx }, { values: hist.tx, colors: C.tx, fill: 0.25 }], { h: 54 })}</div>` +
        kv('Bajada', `<span class="down">↓</span> ${fmtRate(now.net?.rx)}`) +
        kv('Subida', `<span class="up">↑</span> ${fmtRate(now.net?.tx)}`) +
        kv('Pico de bajada (último minuto)', fmtRate(peak)) +
        kv('Descargado en esta sesión', fmtBytes(now.netTotals?.rx || 0)) +
        kv('Subido en esta sesión', fmtBytes(now.netTotals?.tx || 0))
      );
    }
    if (key === 'disk') {
      const d = now.disk;
      return (
        `<div class="dchart">${chartSVG([{ values: hist.dr, colors: C.dr }, { values: hist.dw, colors: C.dw, fill: 0.25 }], { h: 54 })}</div>` +
        (d?.busy != null ? kv('Actividad', `${Math.round(d.busy)} %`) : '') +
        kv('Lectura', fmtRate(d?.r)) +
        kv('Escritura', fmtRate(d?.w)) +
        (now.drives || [])
          .map((v) => {
            const used = ((v.total - v.free) / v.total) * 100;
            return `<div class="ddrive">${kv(`${v.name.replace(/\\$/, '')} ${v.label || ''}`, `${fmtBytes(v.free)} libres de ${fmtBytes(v.total)}`)}${bar(used, used > 90 ? ZONE_COLORS.crit : C.dr)}</div>`;
          })
          .join('')
      );
    }
    if (key === 'cpu-off') return cpuTempHelp(now.cpuTempState);
    if (key.startsWith('t:')) {
      const s = (now.sensors || []).find((x) => 't:' + x.key === key);
      if (!s) return '';
      const r = tempRange[s.key] || {};
      const col = ZONE_COLORS[s.zone];
      const advice = s.zone === 'crit' ? 'Está en zona crítica: revisa que las rejillas no estén tapadas y cierra programas pesados.' : s.zone === 'warn' ? 'Está tibio: es normal con juegos o tareas pesadas, pero vigílalo.' : 'Temperatura cómoda.';
      return (
        `<div class="dtemp"><b style="color:${col[1]}">${s.value} °C</b><span class="dz z-${s.zone}">${ZONE_TEXT[s.zone]}</span></div>` +
        thermoBar(s, r.min, r.max) +
        `<div class="dchart">${chartSVG([{ values: tempHist[s.key] || [], colors: col }], { h: 46, min: 0, max: s.max })}</div>` +
        kv('Cuidado desde', `${s.caution} °C`) +
        kv('Crítico desde', `${s.critical} °C`) +
        kv('Límites', s.limits) +
        (Number.isFinite(r.min) ? kv('Mínima y máxima de la sesión', `${r.min} °C · ${r.max} °C`) : '') +
        kv('Sensor', esc(s.source)) +
        `<p class="dnote">${advice}</p>` +
        (s.key === 'cpu' && !s.real ? '<p class="dnote">Es la temperatura de la placa, cerca del procesador.</p><button class="dguide" data-act="cpu-guide">Ver la del chip</button>' : '')
      );
    }
    return '';
  }

  function renderDrawer() {
    for (const d of [useDrawer, tempDrawer, ioDrawer]) {
      const on = openKey && items.get(openKey)?.drawer === d;
      d.classList.toggle('open', !!on);
      if (on && last) {
        const html = detail(openKey, last);
        if (d.firstChild.innerHTML !== html) d.firstChild.innerHTML = html;
      }
    }
    for (const [k, it] of items) it.el.classList.toggle('active', k === openKey);
  }

  function open(key) {
    openKey = key;
    renderDrawer();
  }

  function scheduleClose() {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      openKey = null;
      renderDrawer();
    }, 420);
  }

  root.addEventListener('pointerover', (e) => {
    if (e.target.closest('.gdrawer')) return clearTimeout(closeTimer);
    const it = e.target.closest('.gitem');
    if (!it) return scheduleClose();
    clearTimeout(closeTimer);
    const k = it.dataset.k;
    if (k === openKey) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => open(k), openKey ? 80 : 260);
  });
  root.addEventListener('pointerleave', scheduleClose);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cpu-guide"], .gitem[data-k="cpu-off"]')) onCpuGuide?.();
  });

  // ---------- Actualización por segundo ----------

  function update(data) {
    const { now, hist } = data || {};
    if (!now) return;
    last = data;

    // Uso
    const cpu = item('cpu', usage);
    cpu.viz.innerHTML = gaugeSVG({ value: now.cpu, colors: C.cpu, unit: '%' });
    cpu.title.textContent = 'Procesador';
    cpu.sub.textContent = now.mhz ? `${num(now.mhz / 1000, 2)} GHz` : `${now.cores?.length || ''} hilos`;
    const mem = item('mem', usage);
    mem.viz.innerHTML = gaugeSVG({ value: now.mem, colors: C.mem, unit: '%' });
    mem.title.textContent = 'Memoria';
    mem.sub.textContent = `${fmtBytes(now.memUsed)} de ${fmtBytes(now.memTotal)}`;
    const gpu = item('gpu', usage);
    gpu.viz.innerHTML = gaugeSVG({ value: now.gpu ? now.gpu.util : NaN, colors: C.gpu, unit: now.gpu ? '%' : '' });
    gpu.title.textContent = 'Gráfica';
    gpu.sub.textContent = now.gpu?.memTotal ? `${fmtBytes(now.gpu.mem)} de video` : now.gpu ? 'En uso' : 'Sin datos';

    // Temperaturas
    const sensors = now.sensors || [];
    const keys = new Set(sensors.map((s) => 't:' + s.key));
    const noCpu = !sensors.some((s) => s.key === 'cpu');
    if (noCpu) keys.add('cpu-off');
    for (const [k, it] of items) {
      if ((k.startsWith('t:') || k === 'cpu-off') && !keys.has(k)) {
        it.el.remove();
        items.delete(k);
      }
    }
    if (noCpu) {
      const it = item('cpu-off', temps);
      if (!it.viz.firstChild) it.viz.innerHTML = gaugeSVG({ value: NaN, zones: { caution: 80, critical: 95 }, min: 20, max: 110, unit: '' });
      it.title.textContent = 'Procesador';
      it.sub.textContent = cpuTempHint(now.cpuTempState);
      temps.prepend(it.el);
    }
    for (const s of sensors) {
      const hst = (tempHist[s.key] ||= []);
      hst.push(s.value);
      if (hst.length > TEMP_SLOTS) hst.shift();
      const r = (tempRange[s.key] ||= { min: s.value, max: s.value });
      r.min = Math.min(r.min, s.value);
      r.max = Math.max(r.max, s.value);
      const it = item('t:' + s.key, temps);
      it.viz.innerHTML = gaugeSVG({ value: s.value, min: 20, max: s.max, zones: s, unit: '°', status: ZONE_TEXT[s.zone] });
      it.title.textContent = s.label;
      it.sub.textContent = s.key === 'cpu' ? (s.real ? 'Sensor del chip' : 'Placa') : s.key === 'gpu' ? (now.gpu?.name || '').replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, '').slice(0, 18) : s.source.slice(0, 18);
      it.el.classList.toggle('hot', s.zone === 'crit');
    }
    const worst = sensors.filter((s) => s.zone !== 'ok').sort((a, b) => b.value - b.critical - (a.value - a.critical))[0];
    onAlert?.(worst || null);

    // Red y disco
    const net = item('net', io, true);
    net.icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4v13m0 0-5-5m5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    net.title.innerHTML = now.net ? `<span class="down">↓</span> ${esc(fmtRate(now.net.rx))}` : 'Red';
    net.sub.innerHTML = now.net ? `<span class="up">↑</span> ${esc(fmtRate(now.net.tx))}` : 'Sin datos';
    net.viz.innerHTML = chartSVG([{ values: hist.rx, colors: C.rx }, { values: hist.tx, colors: C.tx, fill: 0.25 }], { h: 34, w: 120, grid: false, width: 1.6 });
    const disk = item('disk', io, true);
    disk.icon.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="12" r="1.6" fill="currentColor"/><path d="M6.5 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    disk.title.textContent = now.disk?.busy != null ? `Disco ${Math.round(now.disk.busy)} %` : 'Disco';
    disk.sub.textContent = now.disk ? `Lee ${fmtRate(now.disk.r)} · Escribe ${fmtRate(now.disk.w)}` : 'Sin datos';
    disk.viz.innerHTML = chartSVG([{ values: hist.dr, colors: C.dr }, { values: hist.dw, colors: C.dw, fill: 0.25 }], { h: 34, w: 120, grid: false, width: 1.6 });

    if (openKey && !items.has(openKey)) openKey = null;
    if (openKey) renderDrawer();
  }

  return {
    el: root,
    update,
    onAlert: (fn) => (onAlert = fn),
    open: (key) => open(key),
  };
}
