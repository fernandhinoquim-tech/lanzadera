// Página: guía para ver la temperatura real del procesador con LibreHardwareMonitor. Revisa
// cada 2 s en qué paso va y marca solos los pasos cumplidos.
import { h } from '../shared/dom.js';
import { api } from './ctx.js';
import { page, section, card, button, gl } from './ui.js';

export const LHM_URL = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest';
const ORDER = ['off', 'noserver', 'nosensor', 'ok'];

export const CPU_STATUS_TEXT = {
  off: ['Todavía no hay un programa de sensores abierto', 'Empieza por el paso 1.'],
  noserver: ['LibreHardwareMonitor está abierto', 'Falta activar su servidor web (paso 3).'],
  nosensor: ['LibreHardwareMonitor responde, pero no ve el sensor', 'Falta su controlador PawnIO (paso 4).'],
  ok: ['Conectado', 'La temperatura ya aparece en el monitor de rendimiento.'],
  unsupported: ['Solo en Windows', 'En este sistema se usan los sensores que entrega el sistema operativo.'],
};

let status = null;
let timer = null;

export function cpuStatusLine(st) {
  const s = st || { state: 'off' };
  const [title, desc] = CPU_STATUS_TEXT[s.state] || CPU_STATUS_TEXT.off;
  const icon = s.state === 'ok' ? 'circle-check' : s.state === 'off' ? 'thermometer' : 'circle-dot';
  return h('div.temp-status.t-' + s.state,
    h('div.ts-icon', { html: gl(icon) }),
    h('div.ts-text', h('b', { text: title }), h('span', { text: desc })),
    s.state === 'ok' && s.value > 0 ? h('div.ts-value', h('b', { text: `${Math.round(s.value)} °C` }), s.name ? h('small', { text: s.name }) : null) : null
  );
}

function step(state, done, now, { title, desc, control }) {
  const at = ORDER.indexOf(state);
  const k = at >= done ? 'done' : at === now ? 'now' : 'todo';
  const el = card({ icon: k === 'done' ? 'circle-check' : k === 'now' ? 'circle-dot' : 'circle-dashed', title, desc, control });
  el.classList.add('tstep', 't-' + k);
  return el;
}

function draw(box) {
  const st = status || { state: 'off' };
  const s = st.state;
  box.replaceChildren(
    cpuStatusLine(status),
    ...section('Pasos',
      step(s, 1, 0, {
        title: '1. Descarga LibreHardwareMonitor',
        desc: 'Es gratis y de código abierto. Descarga <b>LibreHardwareMonitor.zip</b>, haz clic derecho sobre el archivo › <b>Extraer todo</b> y deja la carpeta en un lugar fijo, por ejemplo en Documentos.',
        control: button('Abrir la descarga', () => api.run('openExternal', LHM_URL), { icon: 'external-link' }),
      }),
      step(s, 1, -1, {
        title: '2. Ábrelo y acepta PawnIO',
        desc: 'Abre <b>LibreHardwareMonitor.exe</b>. Windows pedirá permiso de administrador: lo necesita para leer los sensores. Si pregunta por instalar <b>PawnIO</b>, elige <b>Sí</b>: es el controlador que lee la temperatura.',
      }),
      step(s, 2, 1, {
        title: '3. Activa su servidor web',
        desc: 'En su menú <b>Options › Remote Web Server</b>, marca <b>Run</b> (puerto 8085, el que trae). Si el Firewall de Windows pregunta, puedes elegir <b>Cancelar</b>: Lanzadera lo lee desde este mismo equipo.',
      }),
      step(s, 3, 2, {
        title: '4. Sensor del procesador',
        desc:
          s === 'nosensor'
            ? 'No aparece el sensor porque falta <b>PawnIO</b>. Cierra LibreHardwareMonitor (clic derecho en su icono junto al reloj › <b>Exit</b>), ábrelo de nuevo y acepta instalar PawnIO.' + (st.cpu === false ? ' Revisa también que en su menú <b>Hardware</b> esté marcado <b>CPU</b>.' : '')
            : 'Lanzadera lo encuentra solo en cuanto LibreHardwareMonitor lo publica.',
      }),
      card({ icon: 'power', title: '5. Que quede siempre (opcional)', desc: 'En su menú <b>Options</b>, marca <b>Run On Windows Startup</b>, <b>Start Minimized</b> y <b>Minimize To Tray</b>. Así arranca solo con Windows, escondido junto al reloj.' })
    ),
    ...section('Otras opciones',
      card({ icon: 'cpu', title: '¿Ya usas HWiNFO u OpenHardwareMonitor?', desc: 'También sirven: déjalo abierto. En HWiNFO, entra a <b>Sensors › Configure › HWiNFO Gadget</b>, activa <b>Enable reporting to Gadget</b> y marca la temperatura del procesador con <b>Report value in Gadget</b>.' }),
      card({ icon: 'shield-check', title: '¿Dónde doy los permisos?', desc: 'Windows protege el sensor del procesador: solo lo leen programas con permisos de administrador y un controlador especial. Esos permisos se los das a LibreHardwareMonitor cuando Windows te pregunta al abrirlo (paso 2) y al instalar PawnIO. Lanzadera solo lee lo que él publica en tu equipo (127.0.0.1).' })
    )
  );
}

export function temperaturaPage() {
  const box = h('div.tguide');
  draw(box);
  clearInterval(timer);
  let attached = false;
  const tick = async () => {
    if (!box.isConnected) {
      if (attached) clearInterval(timer);
      return;
    }
    attached = true;
    const st = await api.cpuTempStatus().catch(() => null);
    if (!st || JSON.stringify(st) === JSON.stringify(status)) return;
    status = st;
    draw(box);
  };
  timer = setInterval(tick, 2000);
  setTimeout(tick, 50);
  return page('Temperatura del procesador', 'Para ver la temperatura real del chip, Lanzadera se apoya en LibreHardwareMonitor. Esta guía se marca sola a medida que avanzas.', box);
}
