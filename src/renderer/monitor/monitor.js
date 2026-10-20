// Monitor de rendimiento: flotante (compacto) o en ventana completa.
import { h, applyTheme } from '../shared/dom.js';
import { glyphSVG } from '../shared/tiles.js';
import { fluentUrl } from '../shared/icon-view.js';
import { createDashboard } from '../shared/metrics-view.js';
import { createGadget } from '../shared/metrics-gadget.js';

const api = window.lanz;
const mode = new URLSearchParams(location.search).get('mode') === 'full' ? 'full' : 'compact';
document.documentElement.classList.add('mode-' + mode);
const root = document.getElementById('root');
const dash = mode === 'compact' ? createGadget() : createDashboard({ mode });
let state = null;

function btn(icon, title, onClick, on = false) {
  const b = h('button.btn' + (on ? '.on' : ''), { html: glyphSVG(icon), title });
  b.addEventListener('click', onClick);
  return b;
}

// Aviso en el encabezado cuando una temperatura entra en zona de cuidado o crítica.
function setChip(s) {
  const chip = root.querySelector('.gchip');
  if (!chip) return;
  chip.className = 'gchip' + (s ? ' z-' + s.zone : '');
  chip.textContent = s ? `${s.label} ${s.value}°` : '';
  chip.title = s ? (s.zone === 'crit' ? 'Temperatura crítica' : 'Temperatura en zona de cuidado') : '';
}

function renderCompact() {
  const m = state.config.monitor;
  root.innerHTML = '';
  dash.onAlert?.(setChip);
  root.append(
    h('div.gadget',
      h('div.ghead',
        h('span.live'),
        h('b', { text: 'Rendimiento' }),
        h('span.gchip'),
        btn(m.onTop ? 'pin' : 'pin-off', m.onTop ? 'Siempre visible (clic para soltar)' : 'Fijar encima de las ventanas', () => api.patch({ monitor: { onTop: !m.onTop } }), m.onTop),
        btn('maximize-2', 'Abrir el monitor completo', () => api.run('monitor')),
        btn('x', 'Cerrar el monitor flotante', () => api.patch({ monitor: { gadget: false } }))
      ),
      h('div.gbody', dash.el)
    )
  );
}

function renderFull() {
  root.innerHTML = '';
  root.append(
    h('div.titlebar-drag'),
    h('div.full', h('h1', { html: `<img src="${fluentUrl('1f4c8')}" alt="">Monitor de rendimiento<small>Se actualiza cada segundo</small>` }), dash.el)
  );
}

function fit() {
  if (mode !== 'compact') return;
  const g = root.querySelector('.gadget');
  if (g) api.monitorResize(g.getBoundingClientRect().height + 12);
}

(async () => {
  state = await api.getState();
  applyTheme(state);
  if (mode === 'full' && state.env.mica) document.documentElement.classList.add('mica');
  mode === 'compact' ? renderCompact() : renderFull();
  api.onState((s) => {
    const prevTop = state.config.monitor.onTop;
    state = s;
    applyTheme(s);
    if (mode === 'compact' && prevTop !== s.config.monitor.onTop) renderCompact();
  });
  const snap = await api.metricsSnapshot().catch(() => null);
  if (snap) dash.update(snap);
  api.onMetrics((m) => {
    dash.update(m);
    fit();
  });
  api.metricsSubscribe(true);
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(root);
  fit();
})();
