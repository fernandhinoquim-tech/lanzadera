# Lanzadera - ayudante de Windows.
#   -Mode apps   : lista las apps del menu Inicio (incluidas las de Microsoft Store) en JSON.
#   -Mode icons  : extrae iconos en alta resolucion (256 px) a archivos PNG.
#   -Mode metrics: recolector de rendimiento (una linea JSON por segundo).
#   -Mode usage  : programas mas usados segun Windows (UserAssist).
#   -Mode shell  : ventana activa, programas abiertos, reserva de espacio y foco (permanente).
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$In = '',
  [string]$Out = '',
  [int]$Size = 256,
  [int]$ParentPid = 0
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

function Write-Json($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 4
  [Console]::Out.Write($json)
  [Console]::Out.Flush()
}

if ($Mode -eq 'apps') {
  $list = @()
  try {
    $list = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; appId = [string]$_.AppID } })
  } catch {
    $list = @()
  }
  if ($list.Count -eq 0) {
    try {
      $shell = New-Object -ComObject Shell.Application
      $folder = $shell.NameSpace('shell:AppsFolder')
      $list = @($folder.Items() | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; appId = [string]$_.Path } })
    } catch {}
  }
  Write-Json @($list)
  exit 0
}

if ($Mode -eq 'icons') {
  $cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LzIcons {
  [StructLayout(LayoutKind.Sequential)]
  public struct SIZE { public int cx; public int cy; public SIZE(int x, int y) { cx = x; cy = y; } }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemImageFactory {
    [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);

  static Bitmap FromHBitmap(IntPtr hbmp) {
    using (Bitmap tmp = Image.FromHbitmap(hbmp)) {
      int w = tmp.Width, h = tmp.Height;
      if (Image.GetPixelFormatSize(tmp.PixelFormat) < 32) return new Bitmap(tmp);
      Rectangle r = new Rectangle(0, 0, w, h);
      int row = w * 4;
      byte[] buf = new byte[row * h];
      // Copia fila por fila: el bitmap puede venir invertido (stride negativo).
      BitmapData src = tmp.LockBits(r, ImageLockMode.ReadOnly, tmp.PixelFormat);
      try { for (int y = 0; y < h; y++) Marshal.Copy(IntPtr.Add(src.Scan0, y * src.Stride), buf, y * row, row); }
      finally { tmp.UnlockBits(src); }
      bool alpha = false;
      for (int i = 3; i < buf.Length; i += 4) { if (buf[i] != 0) { alpha = true; break; } }
      if (!alpha) { for (int i = 3; i < buf.Length; i += 4) buf[i] = 255; }
      // El shell entrega alfa premultiplicado: usarlo tal cual evita bordes oscuros.
      Bitmap res = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
      BitmapData dst = res.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
      try { for (int y = 0; y < h; y++) Marshal.Copy(buf, y * row, IntPtr.Add(dst.Scan0, y * dst.Stride), row); }
      finally { res.UnlockBits(dst); }
      return res;
    }
  }

  static Bitmap FromShell(string path, int size) {
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
    IntPtr hbmp = IntPtr.Zero;
    int hr;
    try { hr = f.GetImage(new SIZE(size, size), 0x4, out hbmp); }
    finally { Marshal.ReleaseComObject(f); }
    if (hr != 0 || hbmp == IntPtr.Zero) return null;
    try { return FromHBitmap(hbmp); } finally { DeleteObject(hbmp); }
  }

  static Bitmap FromIconIndex(string file, int index, int size) {
    IntPtr[] h = new IntPtr[1];
    uint[] ids = new uint[1];
    uint n = PrivateExtractIcons(file, index, size, size, h, ids, 1, 0);
    if (n == 0 || n == 0xFFFFFFFF || h[0] == IntPtr.Zero) return null;
    try { using (Icon ic = Icon.FromHandle(h[0])) { return ic.ToBitmap(); } }
    finally { DestroyIcon(h[0]); }
  }

  // Si el icono real es pequeno dentro del lienzo, lo recorta y lo centra.
  // Cuando el programa no trae icono grande, el shell centra uno de 32/48 px y
  // dibuja un marco tenue en el borde: el margen se ignora para no tomarlo como contenido.
  static Bitmap Normalize(Bitmap b, int size) {
    int w = b.Width, h = b.Height, minX = w, minY = h, maxX = -1, maxY = -1;
    int stride = w * 4;
    int m = w >= 64 && h >= 64 ? Math.Min(w, h) / 32 : 0;
    byte[] buf = new byte[stride * h];
    BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try { for (int y = 0; y < h; y++) Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), buf, y * stride, stride); }
    finally { b.UnlockBits(d); }
    for (int y = m; y < h - m; y++) {
      for (int x = m; x < w - m; x++) {
        if (buf[y * stride + x * 4 + 3] > 10) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    int side = Math.Max(maxX - minX + 1, maxY - minY + 1);
    if (side >= w * 0.72 && w == size && h == size) return b;
    side = Math.Min(Math.Min(w, h), side + (int)(side * 0.12));
    int cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    int sx = Math.Max(0, Math.Min(w - side, cx - side / 2));
    int sy = Math.Max(0, Math.Min(h - side, cy - side / 2));
    Bitmap res = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(res))
    using (ImageAttributes ia = new ImageAttributes()) {
      ia.SetWrapMode(WrapMode.TileFlipXY);
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.CompositingQuality = CompositingQuality.HighQuality;
      g.SmoothingMode = SmoothingMode.HighQuality;
      g.Clear(Color.Transparent);
      g.DrawImage(b, new Rectangle(0, 0, size, size), sx, sy, side, side, GraphicsUnit.Pixel, ia);
    }
    b.Dispose();
    return res;
  }

  public static bool Save(string path, int index, bool useIndex, string dest, int size) {
    Bitmap b = null;
    if (useIndex) { try { b = FromIconIndex(path, index, size); } catch { b = null; } }
    if (b == null) b = FromShell(path, size);
    if (b == null) return false;
    Bitmap n = Normalize(b, size);
    if (n == null) { b.Dispose(); return false; }
    n.Save(dest, ImageFormat.Png);
    n.Dispose();
    return true;
  }
}
'@
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $cs -IgnoreWarnings
  $items = Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json
  $res = New-Object System.Collections.ArrayList
  foreach ($it in @($items)) {
    $ok = $false
    $err = ''
    try {
      $dest = Join-Path $Out ([string]$it.key + '.png')
      $ok = [LzIcons]::Save([string]$it.path, [int]$it.index, [bool]$it.useIndex, $dest, $Size)
    } catch {
      $err = $_.Exception.Message
    }
    [void]$res.Add([pscustomobject]@{ key = [string]$it.key; ok = [bool]$ok; error = [string]$err })
  }
  Write-Json @($res)
  exit 0
}

if ($Mode -eq 'metrics') {
  # Recolector de rendimiento: imprime una línea JSON por segundo.
  $cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

public static class LzMet {
  class Cat {
    public PerformanceCounterCategory C;
    public Dictionary<string, CounterSample> Prev = new Dictionary<string, CounterSample>();
    public Cat(string name) { try { if (PerformanceCounterCategory.Exists(name)) C = new PerformanceCounterCategory(name); } catch { C = null; } }
  }

  [StructLayout(LayoutKind.Sequential)]
  struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime; }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);

  static Cat gpu = new Cat("GPU Engine");
  static Cat gpuMem = new Cat("GPU Adapter Memory");
  static Cat net = new Cat("Network Interface");
  static Cat disk = new Cat("PhysicalDisk");
  static Cat proc = new Cat("Processor Information");
  static Cat thermal = new Cat("Thermal Zone Information");
  static string gpuName = "";
  static double gpuTotal = 0;
  static Dictionary<int, double> lastCpu = new Dictionary<int, double>();
  static DateTime lastProcAt = DateTime.MinValue;
  static int cores = Environment.ProcessorCount;
  static CultureInfo IC = CultureInfo.InvariantCulture;

  static string J(string s) {
    if (s == null) return "\"\"";
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c < 32) b.Append(' ');
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }
  static string N(double v) { if (double.IsNaN(v) || double.IsInfinity(v)) return "null"; return Math.Round(v, 2).ToString(IC); }

  // Lee una categoría completa de una sola vez y devuelve valor por instancia (calculando tasas).
  static Dictionary<string, double> Read(Cat cat, string counter, bool rate) {
    Dictionary<string, double> r = new Dictionary<string, double>();
    if (cat.C == null) return r;
    try {
      InstanceDataCollectionCollection all = cat.C.ReadCategory();
      InstanceDataCollection col = all[counter.ToLowerInvariant()];
      if (col == null) return r;
      foreach (InstanceData d in col.Values) {
        string key = counter + "|" + d.InstanceName;
        if (rate) {
          CounterSample prev;
          if (cat.Prev.TryGetValue(key, out prev)) r[d.InstanceName] = CounterSample.Calculate(prev, d.Sample);
          cat.Prev[key] = d.Sample;
        } else {
          r[d.InstanceName] = CounterSample.Calculate(d.Sample);
        }
      }
    } catch { }
    return r;
  }

  public static void Init() {
    try {
      using (RegistryKey cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}")) {
        if (cls != null) foreach (string sub in cls.GetSubKeyNames()) {
          try {
            using (RegistryKey k = cls.OpenSubKey(sub)) {
              if (k == null) continue;
              object mem = k.GetValue("HardwareInformation.qwMemorySize");
              double m = 0;
              if (mem is long) m = (long)mem; else if (mem is byte[] && ((byte[])mem).Length >= 8) m = BitConverter.ToInt64((byte[])mem, 0);
              else if (mem is int) m = (uint)(int)mem;
              string desc = k.GetValue("DriverDesc") as string;
              if (desc != null && m >= gpuTotal) { gpuTotal = m; gpuName = desc; }
            }
          } catch { }
        }
      }
    } catch { }
  }

  static string Gpu() {
    Dictionary<string, double> util = Read(gpu, "Utilization Percentage", true);
    Dictionary<string, double> engines = new Dictionary<string, double>();
    foreach (KeyValuePair<string, double> kv in util) {
      int i = kv.Key.IndexOf("_luid_");
      string eng = i >= 0 ? kv.Key.Substring(i) : kv.Key;
      double v;
      engines.TryGetValue(eng, out v);
      engines[eng] = v + kv.Value;
    }
    double max = 0;
    foreach (double v in engines.Values) if (v > max) max = v;
    double used = 0;
    foreach (double v in Read(gpuMem, "Dedicated Usage", false).Values) if (v > used) used = v;
    if (gpu.C == null && gpuName == "") return "null";
    return "{\"util\":" + N(Math.Min(100, max)) + ",\"mem\":" + N(used) + ",\"memTotal\":" + N(gpuTotal) + ",\"name\":" + J(gpuName) + "}";
  }

  static string Net() {
    double rx = 0, tx = 0;
    Dictionary<string, double> r = Read(net, "Bytes Received/sec", true);
    Dictionary<string, double> t = Read(net, "Bytes Sent/sec", true);
    foreach (KeyValuePair<string, double> kv in r) if (kv.Key.IndexOf("loopback", StringComparison.OrdinalIgnoreCase) < 0 && kv.Key.IndexOf("isatap", StringComparison.OrdinalIgnoreCase) < 0) rx += kv.Value;
    foreach (KeyValuePair<string, double> kv in t) if (kv.Key.IndexOf("loopback", StringComparison.OrdinalIgnoreCase) < 0 && kv.Key.IndexOf("isatap", StringComparison.OrdinalIgnoreCase) < 0) tx += kv.Value;
    if (net.C == null) return "null";
    return "{\"rx\":" + N(rx) + ",\"tx\":" + N(tx) + "}";
  }

  static string Disk() {
    if (disk.C == null) return "null";
    double rd = 0, wr = 0, idle = 100;
    double v;
    if (Read(disk, "Disk Read Bytes/sec", true).TryGetValue("_Total", out v)) rd = v;
    if (Read(disk, "Disk Write Bytes/sec", true).TryGetValue("_Total", out v)) wr = v;
    if (Read(disk, "% Idle Time", true).TryGetValue("_Total", out v)) idle = v;
    return "{\"r\":" + N(rd) + ",\"w\":" + N(wr) + ",\"busy\":" + N(Math.Max(0, Math.Min(100, 100 - idle))) + "}";
  }

  static string Cpu() {
    double perf = 0, freq = 0, v;
    if (Read(proc, "% Processor Performance", true).TryGetValue("_Total", out v)) perf = v;
    if (Read(proc, "Processor Frequency", false).TryGetValue("_Total", out v)) freq = v;
    return "{\"mhz\":" + N(freq > 0 && perf > 0 ? freq * perf / 100 : freq) + ",\"base\":" + N(freq) + "}";
  }

  // Sensores térmicos ACPI de la placa. Muchos equipos de escritorio informan un valor fijo
  // de 301 K (27,85 °C) que no es real: se descarta.
  static string Temps() {
    List<string> l = new List<string>();
    foreach (KeyValuePair<string, double> kv in Read(thermal, "Temperature", false)) {
      if (Math.Abs(kv.Value - 301) < 0.01) continue;
      double c = kv.Value - 273.15;
      if (c > 5 && c < 125) l.Add(N(c));
    }
    return "[" + string.Join(",", l.ToArray()) + "]";
  }

  // Temperatura de la tarjeta gráfica (cualquier marca), como la muestra el Administrador de
  // tareas: D3DKMT_ADAPTER_PERFDATA, con los límites de la propia tarjeta (PERFDATACAPS).
  [StructLayout(LayoutKind.Sequential)] struct KMT_ADAPTERINFO { public uint hAdapter; public uint LuidLow; public int LuidHigh; public uint NumOfSources; public int Precise; }
  [StructLayout(LayoutKind.Sequential)] struct KMT_ENUMADAPTERS2 { public uint NumAdapters; public IntPtr pAdapters; }
  [StructLayout(LayoutKind.Sequential)] struct KMT_QUERYADAPTERINFO { public uint hAdapter; public int Type; public IntPtr pData; public uint DataSize; }
  [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref KMT_ENUMADAPTERS2 e);
  [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref KMT_QUERYADAPTERINFO q);

  static List<uint> adapters = null;
  static Dictionary<uint, byte[]> gpuCaps = new Dictionary<uint, byte[]>();

  static void InitGpuPerf() {
    adapters = new List<uint>();
    try {
      KMT_ENUMADAPTERS2 e = new KMT_ENUMADAPTERS2();
      if (D3DKMTEnumAdapters2(ref e) != 0 || e.NumAdapters == 0 || e.NumAdapters > 32) return;
      int sz = Marshal.SizeOf(typeof(KMT_ADAPTERINFO));
      e.pAdapters = Marshal.AllocHGlobal(sz * (int)e.NumAdapters);
      try {
        if (D3DKMTEnumAdapters2(ref e) != 0) return;
        for (int i = 0; i < e.NumAdapters; i++) {
          KMT_ADAPTERINFO a = (KMT_ADAPTERINFO)Marshal.PtrToStructure(IntPtr.Add(e.pAdapters, i * sz), typeof(KMT_ADAPTERINFO));
          adapters.Add(a.hAdapter);
        }
      } finally { Marshal.FreeHGlobal(e.pAdapters); }
    } catch { }
  }

  static byte[] AdapterInfo(uint h, int type, int size) {
    IntPtr buf = Marshal.AllocHGlobal(size);
    try {
      for (int i = 0; i < size; i++) Marshal.WriteByte(buf, i, 0);
      KMT_QUERYADAPTERINFO q = new KMT_QUERYADAPTERINFO();
      q.hAdapter = h;
      q.Type = type;
      q.pData = buf;
      q.DataSize = (uint)size;
      if (D3DKMTQueryAdapterInfo(ref q) != 0) return null;
      byte[] r = new byte[size];
      Marshal.Copy(buf, r, 0, size);
      return r;
    } catch { return null; }
    finally { Marshal.FreeHGlobal(buf); }
  }

  static string GpuPerf() {
    if (adapters == null) InitGpuPerf();
    string best = "null";
    double bestT = 0;
    foreach (uint h in adapters) {
      byte[] p = AdapterInfo(h, 62, 64);
      if (p == null) continue;
      double t = BitConverter.ToUInt32(p, 56) / 10.0;
      if (t <= 0 || t > 150 || t <= bestT) continue;
      byte[] c;
      if (!gpuCaps.TryGetValue(h, out c)) { c = AdapterInfo(h, 63, 40); gpuCaps[h] = c; }
      double max = c != null ? BitConverter.ToUInt32(c, 28) / 10.0 : 0;
      double warn = c != null ? BitConverter.ToUInt32(c, 32) / 10.0 : 0;
      bestT = t;
      best = "{\"t\":" + N(t) + ",\"fan\":" + BitConverter.ToUInt32(p, 48) + ",\"power\":" + N(BitConverter.ToUInt32(p, 52) / 10.0) + ",\"warn\":" + N(warn) + ",\"max\":" + N(max) + "}";
    }
    return best;
  }

  // Temperatura real del procesador: Windows solo la entrega a programas con un controlador y
  // permisos de administrador. Si LibreHardwareMonitor u OpenHardwareMonitor están abiertos se
  // lee de su proveedor WMI; si HWiNFO comparte sensores con gadgets, de su clave del registro.
  static DateTime cpuTempRetry = DateTime.MinValue;

  static int CpuTempRank(string name) {
    string n = name.ToLowerInvariant();
    if (n.Contains("package")) return 5;
    if (n.Contains("tctl") || n.Contains("tdie")) return 4;
    if (n.Contains("core max")) return 3;
    if (n.Contains("core average")) return 2;
    return 1;
  }

  static string CpuTempWmi(string ns, string src) {
    using (System.Management.ManagementObjectSearcher q = new System.Management.ManagementObjectSearcher(ns, "SELECT Name, Identifier, Value FROM Sensor WHERE SensorType='Temperature'")) {
      double best = 0, any = 0;
      int rank = 0;
      foreach (System.Management.ManagementBaseObject o in q.Get()) {
        string id = Convert.ToString(o["Identifier"]) ?? "";
        if (id.IndexOf("cpu", StringComparison.OrdinalIgnoreCase) < 0) continue;
        double v = Convert.ToDouble(o["Value"], IC);
        if (v <= 0 || v > 125) continue;
        string name = Convert.ToString(o["Name"]) ?? "";
        int r = CpuTempRank(name);
        if (r > rank || (r == rank && v > best)) { rank = r; best = v; }
        if (v > any) any = v;
      }
      double t = rank > 1 ? best : any;
      return t > 0 ? "{\"t\":" + N(t) + ",\"src\":" + J(src) + "}" : null;
    }
  }

  static string CpuTempHwinfo() {
    using (RegistryKey k = Registry.CurrentUser.OpenSubKey("Software\\HWiNFO64\\VSB")) {
      if (k == null) return null;
      double best = 0;
      int rank = 0;
      for (int i = 0; i < 200; i++) {
        object label = k.GetValue("Label" + i);
        if (label == null) break;
        string sensor = Convert.ToString(k.GetValue("Sensor" + i)) ?? "";
        string l = Convert.ToString(label) ?? "";
        string all = (sensor + " " + l).ToLowerInvariant();
        if (!all.Contains("cpu") || !(all.Contains("package") || all.Contains("tctl") || all.Contains("tdie") || all.Contains("core max"))) continue;
        double v;
        string raw = (Convert.ToString(k.GetValue("ValueRaw" + i)) ?? "").Replace(',', '.');
        if (!double.TryParse(raw, NumberStyles.Float, IC, out v) || v <= 0 || v > 125) continue;
        int r = CpuTempRank(l);
        if (r > rank) { rank = r; best = v; }
      }
      return best > 0 ? "{\"t\":" + N(best) + ",\"src\":\"HWiNFO\"}" : null;
    }
  }

  static string CpuTemp() {
    if (DateTime.UtcNow < cpuTempRetry) return "null";
    string r = null;
    try { r = CpuTempWmi("root\\LibreHardwareMonitor", "LibreHardwareMonitor"); } catch { }
    if (r == null) { try { r = CpuTempWmi("root\\OpenHardwareMonitor", "OpenHardwareMonitor"); } catch { } }
    if (r == null) { try { r = CpuTempHwinfo(); } catch { } }
    // Sin ninguna de esas herramientas, se vuelve a mirar cada 20 segundos.
    if (r == null) cpuTempRetry = DateTime.UtcNow.AddSeconds(20);
    return r ?? "null";
  }

  // Temperatura de discos SSD y NVMe (StorageDeviceTemperatureProperty), con los límites que
  // informa el fabricante. Los discos mecánicos no se consultan para no despertarlos.
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, int inSize, byte[] outBuf, int outSize, out int returned, IntPtr ov);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  class SsdInfo { public string Path; public string Name; }
  static List<SsdInfo> ssds = null;

  static IntPtr OpenDrive(string path) {
    IntPtr h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    return h.ToInt64() == -1 ? IntPtr.Zero : h;
  }

  static byte[] StorageQuery(IntPtr h, int prop, int outSize) {
    byte[] q = new byte[12];
    BitConverter.GetBytes(prop).CopyTo(q, 0);
    byte[] o = new byte[outSize];
    int n;
    if (!DeviceIoControl(h, 0x2D1400, q, q.Length, o, o.Length, out n, IntPtr.Zero) || n < 8) return null;
    return o;
  }

  static void InitDisks() {
    ssds = new List<SsdInfo>();
    for (int i = 0; i < 16; i++) {
      string path = "\\\\.\\PhysicalDrive" + i;
      IntPtr h = OpenDrive(path);
      if (h == IntPtr.Zero) continue;
      try {
        byte[] sp = StorageQuery(h, 7, 12);
        if (sp == null || sp[8] != 0) continue;
        string name = "Disco " + (i + 1);
        byte[] dd = StorageQuery(h, 0, 1024);
        if (dd != null) {
          int off = BitConverter.ToInt32(dd, 16);
          if (off > 0 && off < dd.Length) {
            int e = off;
            while (e < dd.Length && dd[e] != 0) e++;
            string m = Encoding.ASCII.GetString(dd, off, e - off).Trim();
            if (m.Length > 0) name = m;
          }
        }
        SsdInfo info = new SsdInfo();
        info.Path = path;
        info.Name = name;
        ssds.Add(info);
      } catch { } finally { CloseHandle(h); }
    }
  }

  static string DiskTemps() {
    if (ssds == null) InitDisks();
    List<string> l = new List<string>();
    foreach (SsdInfo d in ssds) {
      IntPtr h = OpenDrive(d.Path);
      if (h == IntPtr.Zero) continue;
      try {
        byte[] t = StorageQuery(h, 52, 512);
        if (t == null || BitConverter.ToUInt16(t, 12) < 1) continue;
        short temp = BitConverter.ToInt16(t, 26);
        if (temp <= 0 || temp > 120) continue;
        l.Add("{\"name\":" + J(d.Name) + ",\"t\":" + temp + ",\"warn\":" + BitConverter.ToInt16(t, 10) + ",\"crit\":" + BitConverter.ToInt16(t, 8) + "}");
      } catch { } finally { CloseHandle(h); }
    }
    return "[" + string.Join(",", l.ToArray()) + "]";
  }

  static string Battery() {
    SYSTEM_POWER_STATUS s;
    if (!GetSystemPowerStatus(out s) || s.BatteryFlag == 128 || s.BatteryLifePercent == 255) return "null";
    return "{\"pct\":" + s.BatteryLifePercent + ",\"ac\":" + (s.ACLineStatus == 1 ? "true" : "false") + ",\"secs\":" + s.BatteryLifeTime + "}";
  }

  static string Drives() {
    List<string> l = new List<string>();
    foreach (DriveInfo d in DriveInfo.GetDrives()) {
      try {
        if (!d.IsReady || (d.DriveType != DriveType.Fixed && d.DriveType != DriveType.Removable)) continue;
        l.Add("{\"name\":" + J(d.Name) + ",\"label\":" + J(d.VolumeLabel) + ",\"total\":" + N(d.TotalSize) + ",\"free\":" + N(d.AvailableFreeSpace) + "}");
      } catch { }
    }
    return "[" + string.Join(",", l.ToArray()) + "]";
  }

  class PInfo { public string Name; public double Cpu; public double Mem; }

  static string Procs() {
    DateTime now = DateTime.UtcNow;
    double secs = lastProcAt == DateTime.MinValue ? 0 : (now - lastProcAt).TotalSeconds;
    lastProcAt = now;
    Dictionary<string, PInfo> by = new Dictionary<string, PInfo>(StringComparer.OrdinalIgnoreCase);
    Dictionary<int, double> next = new Dictionary<int, double>();
    foreach (Process p in Process.GetProcesses()) {
      try {
        if (p.Id == 0) continue;
        string name = p.ProcessName;
        if (name == "Idle" || name == "System" || name == "Memory Compression") continue;
        PInfo info;
        if (!by.TryGetValue(name, out info)) { info = new PInfo(); info.Name = name; by[name] = info; }
        info.Mem += p.WorkingSet64;
        double t = p.TotalProcessorTime.TotalSeconds;
        next[p.Id] = t;
        double prev;
        if (secs > 0 && lastCpu.TryGetValue(p.Id, out prev)) info.Cpu += Math.Max(0, (t - prev) / secs / cores * 100);
      } catch { } finally { p.Dispose(); }
    }
    lastCpu = next;
    List<PInfo> list = new List<PInfo>(by.Values);
    list.Sort(delegate (PInfo a, PInfo b) { return b.Cpu.CompareTo(a.Cpu); });
    List<string> top = new List<string>();
    for (int i = 0; i < Math.Min(8, list.Count); i++) top.Add("[" + J(list[i].Name) + "," + N(list[i].Cpu) + "," + N(list[i].Mem) + "]");
    list.Sort(delegate (PInfo a, PInfo b) { return b.Mem.CompareTo(a.Mem); });
    List<string> topMem = new List<string>();
    for (int i = 0; i < Math.Min(8, list.Count); i++) topMem.Add("[" + J(list[i].Name) + "," + N(list[i].Cpu) + "," + N(list[i].Mem) + "]");
    return "{\"cpu\":[" + string.Join(",", top.ToArray()) + "],\"mem\":[" + string.Join(",", topMem.ToArray()) + "],\"count\":" + next.Count + "}";
  }

  public static void Run(int parentPid) {
    Init();
    Stream outStream = Console.OpenStandardOutput();
    StreamWriter w = new StreamWriter(outStream, new UTF8Encoding(false));
    w.AutoFlush = true;
    int n = 0;
    string drives = "[]", procs = "null", dtemps = "[]", gperf = "null", ctemp = "null";
    while (true) {
      if (n % 30 == 0) drives = Drives();
      if (n % 2 == 0) procs = Procs();
      if (n % 10 == 0) { try { dtemps = DiskTemps(); } catch { dtemps = "[]"; } }
      if (n % 2 == 0) { try { gperf = GpuPerf(); } catch { gperf = "null"; } }
      if (n % 2 == 1) { try { ctemp = CpuTemp(); } catch { ctemp = "null"; } }
      string line = "{\"gpu\":" + Gpu() + ",\"net\":" + Net() + ",\"disk\":" + Disk() + ",\"cpu\":" + Cpu() + ",\"temps\":" + Temps() +
        ",\"battery\":" + Battery() + ",\"drives\":" + drives + ",\"procs\":" + procs + ",\"gperf\":" + gperf + ",\"dtemps\":" + dtemps + ",\"ctemp\":" + ctemp + "}";
      if (n > 0) w.WriteLine(line);
      n++;
      Thread.Sleep(1000);
      if (parentPid > 0 && n % 5 == 0) {
        try { Process.GetProcessById(parentPid).Dispose(); } catch { return; }
      }
    }
  }
}
'@
  Add-Type -ReferencedAssemblies System.Management -TypeDefinition $cs -IgnoreWarnings
  [LzMet]::Run($ParentPid)
  exit 0
}

if ($Mode -eq 'usage') {
  # Programas mas usados segun Windows (UserAssist): solo lectura y solo en este equipo.
  $res = New-Object System.Collections.ArrayList
  foreach ($g in @('{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}', '{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}')) {
    try {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\$g\Count")
      if (-not $key) { continue }
      foreach ($n in $key.GetValueNames()) {
        $d = $key.GetValue($n)
        if (-not ($d -is [byte[]]) -or $d.Length -lt 68) { continue }
        # Los nombres vienen en ROT13.
        $chars = $n.ToCharArray()
        for ($i = 0; $i -lt $chars.Length; $i++) {
          $c = [int]$chars[$i]
          if ($c -ge 65 -and $c -le 90) { $chars[$i] = [char]((($c - 65 + 13) % 26) + 65) }
          elseif ($c -ge 97 -and $c -le 122) { $chars[$i] = [char]((($c - 97 + 13) % 26) + 97) }
        }
        $runs = [BitConverter]::ToInt32($d, 4)
        $focus = [BitConverter]::ToInt32($d, 12)
        $ft = [BitConverter]::ToInt64($d, 60)
        $last = 0
        if ($ft -gt 116444736000000000) { $last = [int64][Math]::Floor(($ft - 116444736000000000) / 10000) }
        if ($runs -le 0 -and $focus -le 0) { continue }
        [void]$res.Add([pscustomobject]@{ id = (-join $chars); runs = $runs; focus = $focus; last = $last })
      }
      $key.Close()
    } catch {}
  }
  Write-Json @($res)
  exit 0
}

if ($Mode -eq 'shell') {
  # Proceso permanente: informa la ventana activa (pantalla completa, para esquivarla) y los
  # programas abiertos, reserva el espacio del dock (AppBar) y trae ventanas al frente.
  # Ordenes por la entrada estandar, una por linea: bar, unbar, focus, min, quit.
  $cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LzShell {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)] public struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
  }

  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string s);
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);

  class WinInfo { public uint Pid; public string Path; public string Aumid; }

  static readonly object outLock = new object();
  static readonly Queue<string> cmds = new Queue<string>();
  static readonly AutoResetEvent wake = new AutoResetEvent(false);
  static readonly Dictionary<long, WinInfo> infos = new Dictionary<long, WinInfo>();
  static readonly Dictionary<long, uint> bars = new Dictionary<long, uint>();
  static uint cbMsg = 0;
  static uint parent = 0;
  static bool winsNow = false;

  static System.IO.StreamWriter writer;

  static void Out(string s) {
    lock (outLock) { writer.WriteLine(s); writer.Flush(); }
  }

  static string J(string s) {
    if (s == null) return "\"\"";
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  static string R(RECT r) { return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }

  static string ClassOf(IntPtr h) {
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    return sb.ToString();
  }

  static void ReadLoop() {
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        lock (cmds) cmds.Enqueue(line.Trim());
        wake.Set();
      }
    } catch { }
    lock (cmds) cmds.Enqueue("quit");
    wake.Set();
  }

  static string Next() {
    lock (cmds) return cmds.Count > 0 ? cmds.Dequeue() : null;
  }

  // Ventana activa: rectangulo, pantalla completa y si es el escritorio o el menu Inicio.
  static string Fg() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetShellWindow()) return "{\"h\":0,\"desk\":1}";
    string c = ClassOf(h);
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return "{\"h\":" + h.ToInt64() + ",\"desk\":1}";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    bool shell = c == "Windows.UI.Core.CoreWindow" || c == "XamlExplorerHostIslandWindow" || c == "TopLevelWindowForOverflowXamlIsland" || c == "NotifyIconOverflowWindow";
    RECT r;
    if (!GetWindowRect(h, out r)) return "{\"h\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"shell\":" + (shell ? 1 : 0) + "}";
    bool zoomed = IsZoomed(h), min = IsIconic(h), vis = IsWindowVisible(h);
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    bool full = false;
    string mon = "null";
    if (GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) {
      RECT m = mi.rcMonitor;
      mon = R(m);
      full = vis && !zoomed && !shell && r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B;
    }
    return "{\"h\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"r\":" + R(r) + ",\"m\":" + mon + ",\"full\":" + (full ? 1 : 0) +
      ",\"max\":" + (zoomed ? 1 : 0) + ",\"min\":" + (min ? 1 : 0) + ",\"shell\":" + (shell ? 1 : 0) + "}";
  }

  static string ProcPath(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      int n = sb.Capacity;
      return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : "";
    } finally { CloseHandle(h); }
  }

  static string Aumid(IntPtr hwnd) {
    IPropertyStore ps = null;
    try {
      Guid iid = typeof(IPropertyStore).GUID;
      if (SHGetPropertyStoreForWindow(hwnd, ref iid, out ps) != 0 || ps == null) return "";
      PROPERTYKEY k = new PROPERTYKEY();
      k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
      k.pid = 5;
      PROPVARIANT v;
      if (ps.GetValue(ref k, out v) != 0) return "";
      string s = v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : "";
      PropVariantClear(ref v);
      return s ?? "";
    } catch { return ""; }
    finally { if (ps != null) Marshal.ReleaseComObject(ps); }
  }

  // Ventanas que aparecerian en la barra de tareas, de la mas reciente a la mas antigua.
  static string Wins() {
    List<IntPtr> list = new List<IntPtr>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -20);
      bool appw = (ex & 0x40000) != 0;
      if (!appw && ((ex & 0x80) != 0 || (ex & 0x08000000) != 0 || GetWindow(h, 4) != IntPtr.Zero)) return true;
      int cloaked = 0;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      if (GetWindowTextLength(h) == 0) return true;
      string c = ClassOf(h);
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      list.Add(h);
      return true;
    }, IntPtr.Zero);
    HashSet<long> alive = new HashSet<long>();
    StringBuilder b = new StringBuilder("[");
    bool first = true;
    foreach (IntPtr h in list) {
      long k = h.ToInt64();
      alive.Add(k);
      WinInfo info;
      if (!infos.TryGetValue(k, out info)) {
        info = new WinInfo();
        GetWindowThreadProcessId(h, out info.Pid);
        info.Path = ProcPath(info.Pid);
        info.Aumid = Aumid(h);
        infos[k] = info;
      }
      if (info.Pid == parent) continue;
      StringBuilder t = new StringBuilder(160);
      GetWindowText(h, t, 160);
      if (!first) b.Append(',');
      first = false;
      b.Append("{\"h\":" + k + ",\"p\":" + J(info.Path) + ",\"a\":" + J(info.Aumid) + ",\"t\":" + J(t.ToString()) + ",\"m\":" + (IsIconic(h) ? 1 : 0) + "}");
    }
    List<long> gone = new List<long>();
    foreach (long k in infos.Keys) if (!alive.Contains(k)) gone.Add(k);
    foreach (long k in gone) infos.Remove(k);
    return b.Append(']').ToString();
  }

  // Reserva una franja junto al borde para que las ventanas maximizadas no queden debajo del dock.
  static string Bar(IntPtr h, uint edge, int thick, RECT mon, bool force) {
    APPBARDATA d = new APPBARDATA();
    d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = h;
    d.uCallbackMessage = cbMsg;
    long key = h.ToInt64();
    if (force && bars.ContainsKey(key)) { SHAppBarMessage(1, ref d); bars.Remove(key); }
    if (!bars.ContainsKey(key)) {
      if (SHAppBarMessage(0, ref d) == UIntPtr.Zero) {
        SHAppBarMessage(1, ref d);
        if (SHAppBarMessage(0, ref d) == UIntPtr.Zero) return "fail";
      }
      bars[key] = edge;
    }
    d.uEdge = edge;
    d.rc = mon;
    if (edge == 0) d.rc.R = mon.L + thick;
    else if (edge == 1) d.rc.B = mon.T + thick;
    else if (edge == 2) d.rc.L = mon.R - thick;
    else d.rc.T = mon.B - thick;
    SHAppBarMessage(2, ref d);
    if (edge == 0) d.rc.R = d.rc.L + thick;
    else if (edge == 1) d.rc.B = d.rc.T + thick;
    else if (edge == 2) d.rc.L = d.rc.R - thick;
    else d.rc.T = d.rc.B - thick;
    SHAppBarMessage(3, ref d);
    bars[key] = edge;
    return d.rc.L + "," + d.rc.T + "," + d.rc.R + "," + d.rc.B;
  }

  static void Unbar(IntPtr h) {
    APPBARDATA d = new APPBARDATA();
    d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = h;
    SHAppBarMessage(1, ref d);
    bars.Remove(h.ToInt64());
  }

  static void Focus(IntPtr h) {
    if (!IsWindow(h)) return;
    if (IsIconic(h)) ShowWindow(h, 9);
    if (SetForegroundWindow(h) && GetForegroundWindow() == h) return;
    uint pid;
    uint me = GetCurrentThreadId();
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint target = GetWindowThreadProcessId(h, out pid);
    if (fg != 0 && fg != me) AttachThreadInput(me, fg, true);
    if (target != 0 && target != me) AttachThreadInput(me, target, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (target != 0 && target != me) AttachThreadInput(me, target, false);
    if (fg != 0 && fg != me) AttachThreadInput(me, fg, false);
    if (GetForegroundWindow() != h) {
      keybd_event(0x12, 0, 1, UIntPtr.Zero);
      keybd_event(0x12, 0, 3, UIntPtr.Zero);
      SetForegroundWindow(h);
    }
  }

  static void Handle(string cmd) {
    string[] a = cmd.Split(' ');
    try {
      IntPtr h = a.Length > 1 ? new IntPtr(long.Parse(a[1])) : IntPtr.Zero;
      if ((a[0] == "bar" || a[0] == "rebar") && a.Length >= 8) {
        RECT m = new RECT();
        m.L = int.Parse(a[4]); m.T = int.Parse(a[5]); m.R = int.Parse(a[6]); m.B = int.Parse(a[7]);
        Out("bar " + a[1] + " " + Bar(h, uint.Parse(a[2]), int.Parse(a[3]), m, a[0] == "rebar"));
      } else if (a[0] == "unbar") Unbar(h);
      else if (a[0] == "focus") Focus(h);
      else if (a[0] == "min") ShowWindow(h, 6);
      else if (a[0] == "wins") winsNow = true;
    } catch (Exception e) {
      Out("err " + J(cmd + ": " + e.Message));
    }
  }

  public static void Run(int parentPid) {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
    parent = (uint)Math.Max(0, parentPid);
    writer = new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    cbMsg = RegisterWindowMessage("LanzaderaAppBar");
    Out("hello " + cbMsg + " " + RegisterWindowMessage("TaskbarCreated"));
    Thread reader = new Thread(ReadLoop);
    reader.IsBackground = true;
    reader.Start();
    string lastFg = null, lastWins = null;
    int n = 0;
    try {
      while (true) {
        string c;
        while ((c = Next()) != null) {
          if (c == "quit") return;
          if (c.Length > 0) Handle(c);
        }
        string fg = Fg();
        if (fg != lastFg) { lastFg = fg; Out("fg " + fg); }
        if (n % 4 == 0 || winsNow) {
          winsNow = false;
          string w = Wins();
          if (w != lastWins) { lastWins = w; Out("win " + w); }
        }
        if (parentPid > 0 && n % 8 == 0) {
          try { Process.GetProcessById(parentPid).Dispose(); } catch { return; }
        }
        n++;
        wake.WaitOne(250);
      }
    } finally {
      foreach (long k in new List<long>(bars.Keys)) Unbar(new IntPtr(k));
    }
  }
}
'@
  Add-Type -TypeDefinition $cs -IgnoreWarnings
  [LzShell]::Run($ParentPid)
  exit 0
}

Write-Error "Modo desconocido: $Mode"
exit 2
