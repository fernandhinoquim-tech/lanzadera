// Temperatura real del procesador. Windows no la entrega a programas comunes: hace falta un
// controlador (PawnIO) y un programa con permisos de administrador, como LibreHardwareMonitor.
// Si está abierto con su servidor web activado, Lanzadera lee su data.json (solo lectura,
// solo en este equipo).
const http = require('http');
const { isWin } = require('./winhelper');

const PORT = 8085;

// Nombre del sensor → prioridad para representar al procesador completo.
function cpuRank(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('package')) return 5;
  if (n.includes('tctl') || n.includes('tdie')) return 4;
  if (n.includes('core max')) return 3;
  if (n.includes('core average')) return 2;
  return 1;
}

function numberOf(v) {
  if (typeof v === 'number') return v;
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(v ?? ''));
  return m ? Number(m[0].replace(',', '.')) : NaN;
}

// Busca en el árbol de data.json la mejor temperatura del procesador.
function cpuTempFromTree(root) {
  let best = null;
  const walk = (node, inCpu) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.SensorId || node.id || '');
    const cpuHere = inCpu || /cpu/i.test(String(node.ImageURL || '')) || /\/(intelcpu|amdcpu|cpu)\//i.test(id);
    const isTemp = node.Type === 'Temperature' || /\/temperature\//i.test(id) || /°C/.test(String(node.Value || ''));
    if (cpuHere && isTemp && !(node.Children || []).length) {
      const v = numberOf(node.RawValue ?? node.Value);
      const rank = cpuRank(node.Text);
      if (v > 0 && v < 125 && (!best || rank > best.rank || (rank === best.rank && v > best.value))) best = { value: v, rank, name: node.Text };
    }
    for (const c of node.Children || []) walk(c, cpuHere);
  };
  walk(root, false);
  return best && { value: best.value, src: 'LibreHardwareMonitor', name: best.name };
}

function fetchLocal(pathname, timeout = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

class CpuSensors {
  constructor() {
    this.last = null;
    this.retryAt = 0;
  }

  // Temperatura actual (o null). Si el servidor no responde se reintenta cada 20 s.
  async read() {
    if (!isWin || Date.now() < this.retryAt) return this.last;
    const data = await fetchLocal('/data.json');
    if (!data) {
      this.retryAt = Date.now() + 20000;
      this.last = null;
      return null;
    }
    this.last = cpuTempFromTree(data);
    return this.last;
  }
}

module.exports = { CpuSensors, cpuTempFromTree, cpuRank };
