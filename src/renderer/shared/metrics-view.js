// Panel de rendimiento: tarjetas con gráficas en vivo (se usa en el dock, el monitor flotante y la ventana completa).
import { h, esc } from './dom.js';
import { chartSVG, ringSVG, gaugeSVG, fmtBytes, fmtRate, METRIC_COLORS as C, ZONE_TEXT } from './charts.js';
import { fluentUrl } from './icon-view.js';

const ICON = { cpu: '1f4bb', mem: '1f4df', gpu: '1f3ae', net: '1f6dc', disk: '1f4be', procs: '1f4ca', sys: '1f50b', temp: '1f321-fe0f' };

function uptime(s) {
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}

function pct(v) {
  return Number.isFinite(v) ? `${Math.round(v)}<small>%</small>` : '—';
}

function card(key, title, extraClass = '') {
  const el = h(`div.mcard.m-${key}${extraClass}`, {
    html: `<div class="mhead"><img class="micon" src="${fluentUrl(ICON[key])}" alt=""><div class="mtitle"><b>${esc(title)}</b><span class="msub"></span></div><div class="mval"></div></div><div class="mbody"></div>`,
  });
  return { el, sub: el.querySelector('.msub'), val: el.querySelector('.mval'), body: el.querySelector('.mbody') };
}

function bar(p, colors) {
  return `<div class="mbar"><i style="width:${Math.max(0, Math.min(100, p || 0)).toFixed(1)}%;background:linear-gradient(90deg,${colors[0]},${colors[1]})"></i></div>`;
}

function kv(k, v) {
  return `<div class="mkv"><span>${esc(k)}</span><b>${v}</b></div>`;
}

/**
 * Crea el panel. mode: 'full' (todo) | 'popup' (dock) | 'compact' (monitor flotante).
 */
export function createDashboard({ mode = 'full' } = {}) {
  const compact = mode === 'compact';
  const root = h(`div.mdash.mode-${mode}`);
  const cpu = card('cpu', 'Procesador');
  const mem = card('mem', 'Memoria');
  const gpu = card('gpu', 'Gráfica');
  const net = card('net', 'Red');
  const disk = card('disk', 'Disco');
  const temps = compact ? null : card('temp', 'Temperaturas', '.wide');
  const procs = compact ? null : card('procs', 'Programas que más consumen', '.wide');
  const sys = compact ? null : card('sys', 'Sistema', '.wide');
  for (const c of [temps, cpu, mem, gpu, net, disk, procs, sys]) if (c) root.append(c.el);
  const chartH = compact ? 46 : 84;

  const update = ({ now, hist } = {}) => {
    if (!now) return;
    // Procesador
    const ghz = now.mhz ? `${(now.mhz / 1000).toLocaleString('es', { maximumFractionDigits: 2 })} GHz` : '';
    const temp = now.temps?.length ? `${Math.round(Math.max(...now.temps))} °C` : '';
    cpu.val.innerHTML = pct(now.cpu);
    cpu.sub.textContent = compact ? [ghz, temp].filter(Boolean).join(' · ') : now.cpuModel;
    cpu.body.innerHTML =
      chartSVG([{ values: hist.cpu, colors: C.cpu }], { max: 100, h: chartH }) +
      (compact
        ? ''
        : `<div class="cores">${now.cores.map((c) => `<i style="--v:${c}%" title="${c}%"></i>`).join('')}</div>` +
          `<div class="mrow">${kv('Velocidad', ghz || '—')}${kv('Núcleos', now.cores.length)}${temp ? kv('Temperatura', temp) : ''}</div>`);

    // Memoria
    mem.val.innerHTML = pct(now.mem);
    mem.sub.textContent = `${fmtBytes(now.memUsed)} de ${fmtBytes(now.memTotal)}`;
    mem.body.innerHTML =
      chartSVG([{ values: hist.mem, colors: C.mem }], { max: 100, h: chartH }) +
      (compact ? '' : `${bar(now.mem, C.mem)}<div class="mrow">${kv('En uso', fmtBytes(now.memUsed))}${kv('Disponible', fmtBytes(now.memTotal - now.memUsed))}</div>`);

    // Gráfica
    const g = now.gpu;
    if (g) {
      gpu.el.classList.remove('na');
      gpu.val.innerHTML = pct(g.util);
      gpu.sub.textContent = g.name || 'Tarjeta gráfica';
      const vram = g.memTotal ? (g.mem / g.memTotal) * 100 : null;
      gpu.body.innerHTML =
        chartSVG([{ values: hist.gpu, colors: C.gpu }], { max: 100, h: chartH }) +
        (compact
          ? ''
          : (vram !== null ? bar(vram, C.gpu) : '') +
            `<div class="mrow">${g.memTotal ? kv('Memoria de video', `${fmtBytes(g.mem)} / ${fmtBytes(g.memTotal)}`) : g.mem ? kv('Memoria de video', fmtBytes(g.mem)) : ''}${g.temp != null ? kv('Temperatura', `${g.temp} °C`) : ''}${g.fan != null ? kv('Ventilador', `${g.fan} %`) : ''}${g.power != null ? kv('Consumo', `${Math.round(g.power)} W`) : ''}</div>`);
    } else {
      gpu.el.classList.add('na');
      gpu.val.innerHTML = '—';
      gpu.sub.textContent = 'No disponible';
      gpu.body.innerHTML = compact ? '' : '<div class="mna">Windows no informó el uso de la gráfica en este equipo.</div>';
    }

    // Red
    const n = now.net;
    net.val.innerHTML = n ? `<span class="down">↓</span>${esc(fmtRate(n.rx))}` : '—';
    net.sub.innerHTML = n ? `<span class="up">↑</span> ${esc(fmtRate(n.tx))}` : 'Sin datos';
    net.body.innerHTML =
      chartSVG([{ values: hist.rx, colors: C.rx }, { values: hist.tx, colors: C.tx, fill: 0.25 }], { h: chartH }) +
      (compact ? '' : `<div class="mrow">${kv('Descargado en esta sesión', fmtBytes(now.netTotals?.rx || 0))}${kv('Subido', fmtBytes(now.netTotals?.tx || 0))}</div>`);

    // Disco
    const d = now.disk;
    disk.val.innerHTML = d?.busy != null ? pct(d.busy) : d ? esc(fmtRate((d.r || 0) + (d.w || 0))) : '—';
    disk.sub.textContent = d ? `Lee ${fmtRate(d.r)} · Escribe ${fmtRate(d.w)}` : 'Sin datos';
    disk.body.innerHTML =
      chartSVG([{ values: hist.dr, colors: C.dr }, { values: hist.dw, colors: C.dw, fill: 0.25 }], { h: chartH }) +
      (compact || !now.drives?.length
        ? ''
        : `<div class="drives">${now.drives
            .map((v) => {
              const used = ((v.total - v.free) / v.total) * 100;
              return `<div class="drive"><div class="mkv"><span>${esc(v.name.replace(/\\$/, ''))} ${esc(v.label || '')}</span><b>${fmtBytes(v.free)} libres de ${fmtBytes(v.total)}</b></div>${bar(used, used > 90 ? ['#fca5a5', '#dc2626'] : C.dr)}</div>`;
            })
            .join('')}</div>`);

    // Temperaturas: medidores con zona normal, de cuidado y crítica
    if (temps) {
      const list = now.sensors || [];
      const worst = list.filter((s) => s.zone !== 'ok').sort((a, b) => b.value - b.critical - (a.value - a.critical))[0];
      temps.val.innerHTML = worst ? `<span class="tz-${worst.zone}" style="font-size:14px">${ZONE_TEXT[worst.zone]}</span>` : '';
      temps.sub.textContent = list.length ? 'Amarillo: cuidado · Rojo: crítico' : '';
      temps.body.innerHTML = list.length
        ? `<div class="tgauges">${list
            .map(
              (s) =>
                `<div class="tgauge"><div class="tg-viz">${gaugeSVG({ value: s.value, min: 20, max: s.max, zones: s, unit: '°', status: ZONE_TEXT[s.zone] })}</div>` +
                `<div><b>${esc(s.label)}</b><small>${esc(s.source)}</small><small>Cuidado desde ${s.caution} °C · Crítico desde ${s.critical} °C</small><small>Límites ${esc(s.limits)}</small></div></div>`
            )
            .join('')}</div>`
        : '<div class="mna">Este equipo no comparte temperaturas con Windows sin permisos especiales. La de la tarjeta gráfica y la de los discos SSD aparecen cuando su controlador las informa.</div>';
    }

    // Procesos
    if (procs) {
      const list = now.procs?.cpu || [];
      procs.sub.textContent = now.procs ? `${now.procs.count} procesos` : '';
      procs.val.innerHTML = '';
      procs.body.innerHTML = list.length
        ? `<div class="plist">${list
            .slice(0, 6)
            .map(([name, c, m]) => `<div class="prow"><span class="pname">${esc(name)}</span><div class="mbar"><i style="width:${Math.min(100, c).toFixed(1)}%;background:linear-gradient(90deg,${C.cpu[0]},${C.cpu[1]})"></i></div><b>${c.toLocaleString('es', { maximumFractionDigits: 1 })} %</b><span class="pmem">${fmtBytes(m)}</span></div>`)
            .join('')}</div>`
        : `<div class="mna">${navigator.platform.startsWith('Win') ? 'Calculando…' : 'Disponible en Windows.'}</div>`;
    }

    // Sistema
    if (sys) {
      const b = now.battery;
      sys.val.innerHTML = '';
      sys.sub.textContent = now.host || '';
      sys.body.innerHTML =
        `<div class="srow">` +
        `<div class="sitem">${ringSVG(now.cpu, C.cpu, { label: `${now.cpu}%` })}<span>CPU</span></div>` +
        `<div class="sitem">${ringSVG(now.mem, C.mem, { label: `${now.mem}%` })}<span>Memoria</span></div>` +
        (now.gpu ? `<div class="sitem">${ringSVG(now.gpu.util, C.gpu, { label: `${Math.round(now.gpu.util || 0)}%` })}<span>Gráfica</span></div>` : '') +
        (b ? `<div class="sitem">${ringSVG(b.pct, b.pct < 20 ? ['#fca5a5', '#dc2626'] : ['#86efac', '#16a34a'], { label: `${b.pct}%` })}<span>Batería${b.ac ? ' ⚡' : ''}</span></div>` : '') +
        `<div class="sinfo">${kv('Encendido desde hace', uptime(now.uptime))}${b && !b.ac && b.secs > 0 ? kv('Batería restante', uptime(b.secs)) : ''}${now.temps?.length ? kv('Temperatura', `${Math.round(Math.max(...now.temps))} °C`) : ''}</div>` +
        `</div>`;
    }
  };

  return { el: root, update };
}
