# Lanzadera - ayudante de Windows.
#   -Mode apps   : lista las apps del menu Inicio (incluidas las de Microsoft Store) en JSON.
#   -Mode icons  : extrae iconos en alta resolucion (256 px) a archivos PNG.
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

  static string Temps() {
    List<string> l = new List<string>();
    foreach (KeyValuePair<string, double> kv in Read(thermal, "Temperature", false)) {
      double c = kv.Value - 273.15;
      if (c > 5 && c < 125) l.Add(N(c));
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
    string drives = "[]", procs = "null";
    while (true) {
      if (n % 30 == 0) drives = Drives();
      if (n % 2 == 0) procs = Procs();
      string line = "{\"gpu\":" + Gpu() + ",\"net\":" + Net() + ",\"disk\":" + Disk() + ",\"cpu\":" + Cpu() + ",\"temps\":" + Temps() +
        ",\"battery\":" + Battery() + ",\"drives\":" + drives + ",\"procs\":" + procs + "}";
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
  Add-Type -TypeDefinition $cs -IgnoreWarnings
  [LzMet]::Run($ParentPid)
  exit 0
}

if ($Mode -eq 'watch') {
  # Vigila si la ventana activa ocupa toda una pantalla (video o juego en pantalla completa).
  $cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LzFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

  public static void Init() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  public static string State() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetShellWindow() || !IsWindowVisible(h) || IsZoomed(h)) return "0";
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow" || c == "XamlExplorerHostIslandWindow") return "0";
    RECT r;
    if (!GetWindowRect(h, out r)) return "0";
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "0";
    RECT m = mi.rcMonitor;
    bool full = r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B;
    return full ? ("1," + m.L + "," + m.T + "," + m.R + "," + m.B) : "0";
  }
}
'@
  Add-Type -TypeDefinition $cs -IgnoreWarnings
  [LzFg]::Init()
  $last = ''
  $n = 0
  while ($true) {
    $s = [LzFg]::State()
    if ($s -ne $last) {
      [Console]::Out.WriteLine($s)
      [Console]::Out.Flush()
      $last = $s
    }
    Start-Sleep -Milliseconds 700
    $n++
    if ($ParentPid -gt 0 -and ($n % 6) -eq 0) {
      if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
    }
  }
}

Write-Error "Modo desconocido: $Mode"
exit 2
