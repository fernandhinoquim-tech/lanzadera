// Temperatura real del procesador. Windows no la entrega a programas comunes: hace falta un
// controlador (PawnIO) y un programa con permisos de administrador, como LibreHardwareMonitor.
// Si está abierto con su servidor web activado, Lanzadera lee su data.json (solo lectura,
// solo en este equipo).
const http = require('http');
const { execFile } = require('child_process');
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

// ¿El árbol trae el procesador? Sin el controlador PawnIO aparece con carga y reloj, pero sin
// temperaturas.
function hasCpu(root) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (/cpu/i.test(String(node.ImageURL || '')) || /^\/(intelcpu|amdcpu|cpu)\//i.test(String(node.SensorId || node.id || ''))) return true;
    return (node.Children || []).some(walk);
  };
  return walk(root);
}

// Nombre del programa de sensores abierto (LibreHardwareMonitor u OpenHardwareMonitor), o ''.
function sensorAppRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => {
      const m = /"(LibreHardwareMonitor|OpenHardwareMonitor)\.exe"/i.exec(String(out || ''));
      resolve(m ? m[1] : '');
    });
  });
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
    // off: no hay programa de sensores · noserver: está abierto sin su servidor web ·
    // nosensor: responde pero sin la temperatura (falta PawnIO) · ok: hay temperatura.
    this.status = { state: isWin ? 'off' : 'unsupported' };
  }

  // Temperatura actual (o null). Si no hay temperatura se reintenta cada 20 s.
  async read() {
    if (!isWin) return null;
    if (Date.now() < this.retryAt) return this.last;
    if (this.busy) return this.busy;
    this.busy = this.fetch().finally(() => (this.busy = null));
    return this.busy;
  }

  async fetch() {
    this.fetchedAt = Date.now();
    const data = await fetchLocal('/data.json');
    if (!data) {
      this.last = null;
      const app = await sensorAppRunning();
      this.status = { state: app ? 'noserver' : 'off', app };
      this.retryAt = Date.now() + 20000;
      return null;
    }
    this.last = cpuTempFromTree(data);
    this.status = this.last ? { state: 'ok', value: this.last.value, name: this.last.name } : { state: 'nosensor', cpu: hasCpu(data) };
    if (!this.last) this.retryAt = Date.now() + 20000;
    return this.last;
  }

  // Estado para la guía (que pregunta cada 2 s): vuelve a leer sin esperar el reintento.
  async check() {
    if (Date.now() - (this.fetchedAt || 0) > 1500) this.retryAt = 0;
    await this.read();
    return this.status;
  }
}

module.exports = { CpuSensors, cpuTempFromTree, cpuRank, hasCpu };
