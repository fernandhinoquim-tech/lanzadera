// Monitor de rendimiento: CPU, memoria, gráfica, red, disco, temperaturas, batería y procesos.
// Solo trabaja mientras alguna ventana lo está mostrando.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isWin, helperPath } = require('./winhelper');

const HISTORY = 90;
const SERIES = ['cpu', 'mem', 'gpu', 'rx', 'tx', 'dr', 'dw'];
const ALERT_COOLDOWN = 10 * 60 * 1000;

function zoneOf(v, caution, critical) {
  return v >= critical ? 'crit' : v >= caution ? 'warn' : 'ok';
}

// Sensores de temperatura con sus zonas: amarillo (cuidado) y rojo (crítico). Se usan los
// límites que informa cada componente cuando existen; si no, valores habituales.
function buildSensors({ temps, cpuTemp, gpuTemp, gpuName, disks }) {
  const list = [];
  if (cpuTemp?.value > 0) {
    list.push({ key: 'cpu', label: 'Procesador', value: cpuTemp.value, caution: 80, critical: 95, source: `Sensor del procesador (vía ${cpuTemp.src || 'LibreHardwareMonitor'})`, limits: 'habituales', real: true });
  } else if (temps?.length) {
    list.push({ key: 'cpu', label: 'Procesador', value: Math.max(...temps), caution: 80, critical: 95, source: 'Sensor térmico de la placa (ACPI)', limits: 'habituales' });
  }
  if (gpuTemp) {
    const own = gpuTemp.warn >= 60 && gpuTemp.warn <= 120;
    const crit = own ? Math.round(gpuTemp.warn) : 90;
    list.push({ key: 'gpu', label: 'Gráfica', value: gpuTemp.value, caution: crit - 10, critical: crit, source: gpuName || 'Tarjeta gráfica', limits: own ? 'de la tarjeta' : 'habituales' });
  }
  const many = (disks || []).length > 1;
  (disks || []).forEach((d, i) => {
    const own = d.warn >= 40 && d.warn <= 110;
    const crit = own ? d.warn : 70;
    list.push({ key: 'disk' + i, label: many ? `SSD ${i + 1}` : 'SSD', value: d.t, caution: crit - 10, critical: crit, source: d.name || 'Unidad SSD', limits: own ? 'del fabricante' : 'habituales', makerCritical: d.crit > 0 ? d.crit : null });
  });
  for (const s of list) {
    s.value = Math.round(s.value);
    s.zone = zoneOf(s.value, s.caution, s.critical);
    s.max = Math.ceil((s.critical + 15) / 10) * 10;
  }
  return list;
}

// Respaldo para Linux (desarrollo): sensores de /sys/class/thermal.
function linuxTemps() {
  const out = [];
  try {
    for (const z of fs.readdirSync('/sys/class/thermal')) {
      if (!z.startsWith('thermal_zone')) continue;
      const v = Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000;
      if (v > 5 && v < 125) out.push(v);
    }
  } catch {}
  return out;
}

function cpuSnapshot() {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

// Respaldo para Linux (desarrollo): lee /proc.
function procTotals() {
  const out = { rx: 0, tx: 0, dr: 0, dw: 0 };
  try {
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      out.rx += f[0];
      out.tx += f[8];
    }
  } catch {}
  try {
    for (const line of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10 || !/^(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])$/.test(f[2])) continue;
      out.dr += Number(f[5]) * 512;
      out.dw += Number(f[9]) * 512;
    }
  } catch {}
  return out;
}

class Metrics extends EventEmitter {
  // config: devuelve la configuración del monitor (para saber si avisar temperaturas críticas).
  // cpuReader: lee la temperatura real del procesador (LibreHardwareMonitor) si está disponible;
  // cpuStatus: en qué paso está (abierto, sin servidor web, sin sensor) para guiar al usuario.
  constructor({ config = () => ({}), cpuReader = null, cpuStatus = null } = {}) {
    super();
    this.config = config;
    this.cpuReader = cpuReader;
    this.cpuStatus = cpuStatus;
    this.lhmTemp = null;
    this.ticks = 0;
    this.critCount = {};
    this.lastAlert = {};
    this.subs = new Map();
    this.timer = null;
    this.child = null;
    this.win = null;
    this.prevCpu = null;
    this.prevProc = null;
    this.hist = Object.fromEntries(SERIES.map((k) => [k, []]));
    this.latest = null;
    this.stopTimer = null;
    this.nvidia = null;
    this.nvidiaAt = 0;
    this.totals = { rx: 0, tx: 0 };
  }

  subscribe(wc, on) {
    if (on) {
      this.subs.set(wc.id, wc);
      wc.once('destroyed', () => this.unsubscribe(wc.id));
      clearTimeout(this.stopTimer);
      this.start();
    } else this.unsubscribe(wc.id);
  }

  unsubscribe(id) {
    this.subs.delete(id);
    if (!this.subs.size) {
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => this.stop(), 15000);
    }
  }

  start() {
    if (this.timer) return;
    this.prevCpu = cpuSnapshot();
    this.timer = setInterval(() => this.tick(), 1000);
    if (isWin) this.startSampler();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.child?.kill();
    this.child = null;
  }

  startSampler() {
    if (this.child) return;
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      this.child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(), '-Mode', 'metrics', '-ParentPid', String(process.pid)], { windowsHide: true });
    } catch {
      this.child = null;
      return;
    }
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try {
          this.win = JSON.parse(line);
          this.winAt = Date.now();
        } catch {}
      }
    });
    this.child.stderr.on('data', (d) => (this.lastError = String(d).slice(0, 500)));
    this.child.on('error', () => {});
    this.child.on('exit', () => {
      this.child = null;
      if (this.timer) setTimeout(() => this.timer && this.startSampler(), 5000);
    });
  }

  // nvidia-smi da temperatura y uso exactos en tarjetas NVIDIA.
  pollNvidia() {
    if (!isWin || this.nvidia === false || Date.now() - this.nvidiaAt < 3000) return;
    this.nvidiaAt = Date.now();
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
    if (!fs.existsSync(exe)) {
      this.nvidia = false;
      return;
    }
    execFile(exe, ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,fan.speed,power.draw', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return;
      const [name, temp, util, used, total, fan, power] = String(out).split('\n')[0].split(',').map((x) => x.trim());
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
      this.nvidia = { name, temp: num(temp), util: num(util), mem: num(used) * 1048576, memTotal: num(total) * 1048576, fan: num(fan), power: num(power) };
    });
  }

  tick() {
    this.ticks++;
    if (isWin && this.cpuReader && this.ticks % 2 === 0) {
      this.cpuReader()
        .then((t) => (this.lhmTemp = t))
        .catch(() => (this.lhmTemp = null));
    }
    const cur = cpuSnapshot();
    const cores = cur.map((c, i) => {
      const p = this.prevCpu?.[i];
      if (!p) return 0;
      const dt = c.total - p.total;
      return dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - (c.idle - p.idle) / dt)))) : 0;
    });
    this.prevCpu = cur;
    const cpu = cores.length ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) : 0;
    const memTotal = os.totalmem();
    const memUsed = memTotal - os.freemem();

    let net = null;
    let disk = null;
    let gpu = null;
    let extra = {};
    let gpuTemp = null;
    let cpuTemp = null;
    let diskTemps = [];
    if (isWin) {
      const w = this.win && Date.now() - this.winAt < 5000 ? this.win : null;
      if (w) {
        net = w.net;
        disk = w.disk;
        gpu = w.gpu;
        extra = { mhz: w.cpu?.mhz || null, baseMhz: w.cpu?.base || null, temps: w.temps || [], battery: w.battery, drives: w.drives || [], procs: w.procs };
        diskTemps = Array.isArray(w.dtemps) ? w.dtemps : [];
        if (w.ctemp?.t > 0) cpuTemp = { value: w.ctemp.t, src: w.ctemp.src };
        if (this.lhmTemp?.value > 0) cpuTemp = { value: this.lhmTemp.value, src: this.lhmTemp.src };
        if (w.gperf?.t > 0) {
          gpuTemp = { value: w.gperf.t, warn: w.gperf.warn };
          gpu = { ...(gpu || {}), temp: Math.round(w.gperf.t), fanRpm: w.gperf.fan || null };
        }
      }
      this.pollNvidia();
      if (this.nvidia && typeof this.nvidia === 'object') {
        gpu = { ...(gpu || {}), name: this.nvidia.name || gpu?.name, util: this.nvidia.util ?? gpu?.util, mem: this.nvidia.mem || gpu?.mem, memTotal: this.nvidia.memTotal || gpu?.memTotal, temp: this.nvidia.temp ?? gpu?.temp, fan: this.nvidia.fan, power: this.nvidia.power };
        if (this.nvidia.temp != null) gpuTemp = { value: this.nvidia.temp, warn: gpuTemp?.warn };
      }
    } else {
      extra = { temps: linuxTemps() };
      const t = procTotals();
      if (this.prevProc) {
        net = { rx: Math.max(0, t.rx - this.prevProc.rx), tx: Math.max(0, t.tx - this.prevProc.tx) };
        disk = { r: Math.max(0, t.dr - this.prevProc.dr), w: Math.max(0, t.dw - this.prevProc.dw), busy: null };
      }
      this.prevProc = t;
    }
    if (net) {
      this.totals.rx += net.rx;
      this.totals.tx += net.tx;
    }

    const sample = {
      t: Date.now(),
      cpu,
      cores,
      cpuModel: os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim() || '',
      mem: Math.round((memUsed / memTotal) * 100),
      memUsed,
      memTotal,
      gpu,
      net,
      netTotals: { ...this.totals },
      disk,
      uptime: os.uptime(),
      host: os.hostname(),
      ...extra,
    };
    sample.sensors = buildSensors({ temps: sample.temps, cpuTemp, gpuTemp, gpuName: gpu?.name, disks: diskTemps });
    sample.cpuTempSource = cpuTemp ? cpuTemp.src : sample.temps?.length ? 'acpi' : null;
    sample.cpuTempState = cpuTemp ? 'ok' : this.cpuStatus?.()?.state || null;
    this.checkAlerts(sample.sensors);
    const push = (k, v) => {
      const a = this.hist[k];
      a.push(v ?? 0);
      if (a.length > HISTORY) a.shift();
    };
    push('cpu', cpu);
    push('mem', sample.mem);
    push('gpu', gpu?.util);
    push('rx', net?.rx);
    push('tx', net?.tx);
    push('dr', disk?.r);
    push('dw', disk?.w);
    this.latest = sample;
    const payload = { now: sample, hist: this.hist };
    for (const wc of this.subs.values()) if (!wc.isDestroyed()) wc.send('metrics', payload);
    this.emit('sample', payload);
  }

  // Aviso si una temperatura se mantiene en zona crítica (3 muestras seguidas).
  checkAlerts(sensors) {
    const now = Date.now();
    for (const s of sensors) {
      this.critCount[s.key] = s.zone === 'crit' ? (this.critCount[s.key] || 0) + 1 : 0;
      if (this.critCount[s.key] !== 3 || this.config().alerts === false) continue;
      if (now - (this.lastAlert[s.key] || 0) < ALERT_COOLDOWN) continue;
      this.lastAlert[s.key] = now;
      this.emit('alert', s);
    }
  }

  snapshot() {
    return this.latest ? { now: this.latest, hist: this.hist } : null;
  }
}

module.exports = { Metrics, buildSensors, zoneOf };
