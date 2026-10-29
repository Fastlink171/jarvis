# Jarvis PC-control helper. Started once by Jarvis and kept running, so actions are instant.
# Reads one JSON command per line on stdin, writes one JSON reply per line on stdout.
param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Jarvis {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
  }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

  public static class Audio {
    static IAudioEndpointVolume Vol() {
      var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
      IMMDevice dev = null;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
      IAudioEndpointVolume epv = null;
      var epvid = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
      return epv;
    }
    public static float Volume {
      get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
      set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
    }
    public static bool Mute {
      get { bool mute; Marshal.ThrowExceptionForHR(Vol().GetMute(out mute)); return mute; }
      set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
    }
  }

  public static class Input {
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    static bool IsExt(byte v) { return (v >= 0x21 && v <= 0x2E) || v == 0x5B || v == 0x5C || (v >= 0xA6 && v <= 0xB7); }
    public static void Down(byte vk) { keybd_event(vk, 0, IsExt(vk) ? 1u : 0u, UIntPtr.Zero); }
    public static void Up(byte vk) { keybd_event(vk, 0, (IsExt(vk) ? 1u : 0u) | 2u, UIntPtr.Zero); }
    public static void Tap(byte vk) { Down(vk); Up(vk); }
    public static void Combo(byte[] vks) {
      foreach (var v in vks) Down(v);
      for (int i = vks.Length - 1; i >= 0; i--) Up(vks[i]);
    }
    public static uint Type(string s) {
      var list = new List<INPUT>();
      foreach (char c in s) {
        foreach (uint up in new uint[] { 0u, 2u }) {
          var x = new INPUT(); x.type = 1; x.u.ki.wVk = 0; x.u.ki.wScan = c; x.u.ki.dwFlags = 4u | up; list.Add(x);
        }
      }
      if (list.Count == 0) return 0;
      return SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    }
  }

  public class WinInfo { public long Handle; public string Title; public int Pid; public bool Minimized; }

  public static class Win {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    public static List<WinInfo> List() {
      var r = new List<WinInfo>();
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h)) return true;
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        if (sb.Length == 0) return true;
        if (GetWindow(h, 4) != IntPtr.Zero) return true;            // owned popups
        if ((GetWindowLong(h, -20) & 0x80) != 0) return true;       // tool windows
        uint pid; GetWindowThreadProcessId(h, out pid);
        r.Add(new WinInfo { Handle = h.ToInt64(), Title = sb.ToString(), Pid = (int)pid, Minimized = IsIconic(h) });
        return true;
      }, IntPtr.Zero);
      return r;
    }
    public static long Foreground() { return GetForegroundWindow().ToInt64(); }
    public static bool Focus(long handle) {
      var h = new IntPtr(handle);
      if (IsIconic(h)) ShowWindow(h, 9);
      keybd_event(0x12, 0, 0, UIntPtr.Zero);       // tapping Alt lets us take the foreground
      bool ok = SetForegroundWindow(h);
      keybd_event(0x12, 0, 2, UIntPtr.Zero);
      return ok;
    }
    public static void Show(long handle, int cmd) { ShowWindow(new IntPtr(handle), cmd); }
    public static void Close(long handle) { PostMessage(new IntPtr(handle), 0x0010, IntPtr.Zero, IntPtr.Zero); }
  }
}
'@

$VK = @{
  ctrl = 0x11; control = 0x11; shift = 0x10; alt = 0x12; win = 0x5B; windows = 0x5B; enter = 0x0D; return = 0x0D; esc = 0x1B; escape = 0x1B
  tab = 0x09; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; insert = 0x2D; up = 0x26; down = 0x28; left = 0x25; right = 0x27
  home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22; printscreen = 0x2C; capslock = 0x14
  playpause = 0xB3; nexttrack = 0xB0; prevtrack = 0xB1; volumeup = 0xAF; volumedown = 0xAE; volumemute = 0xAD
  comma = 0xBC; period = 0xBE; minus = 0xBD; plus = 0xBB; slash = 0xBF
}
function Get-Vk([string]$k) {
  $k = $k.Trim().ToLower()
  if ($VK.ContainsKey($k)) { return [byte]$VK[$k] }
  if ($k -match '^f([1-9]|1[0-2])$') { return [byte](0x6F + [int]$Matches[1]) }
  if ($k -match '^[a-z0-9]$') { return [byte][char]$k.ToUpper() }
  throw "Unknown key: $k"
}
$MEDIA = @{ play_pause = 0xB3; next = 0xB0; previous = 0xB1; stop = 0xB2; mute = 0xAD; volume_down = 0xAE; volume_up = 0xAF }

function Get-Windows {
  $names = @{}; Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName }
  $fg = [Jarvis.Win]::Foreground()
  [Jarvis.Win]::List() | ForEach-Object { [ordered]@{ handle = $_.Handle; title = $_.Title; app = $names[$_.Pid]; minimized = $_.Minimized; active = ($_.Handle -eq $fg) } }
}
function Find-Window([string]$q) {
  $q = $q.ToLower().Trim()
  $all = @(Get-Windows | Where-Object { $_.app -ne 'Jarvis' })
  $hit = $all | Where-Object { $_.app -and $_.app.ToLower() -eq $q } | Select-Object -First 1
  if (-not $hit) { $hit = $all | Where-Object { $_.app -and $_.app.ToLower().Contains($q) } | Select-Object -First 1 }
  if (-not $hit) { $hit = $all | Where-Object { $_.title.ToLower().Contains($q) } | Select-Object -First 1 }
  return $hit
}
function Get-NowPlaying {
  $sp = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if ($sp) {
    $t = $sp.MainWindowTitle
    if ($t -match '^Spotify( Premium| Free)?$') { return @{ app = 'Spotify'; playing = $false; title = $null } }
    return @{ app = 'Spotify'; playing = $true; title = $t }
  }
  $yt = Get-Windows | Where-Object { $_.title -match ' - YouTube' } | Select-Object -First 1
  if ($yt) { return @{ app = 'YouTube'; playing = $null; title = ($yt.title -replace ' - YouTube.*$', '') } }
  return @{ app = $null; playing = $null; title = $null }
}
function Get-Vol { try { return @{ volume = [int][Math]::Round([Jarvis.Audio]::Volume * 100); muted = [Jarvis.Audio]::Mute } } catch { return @{ volume = $null; muted = $null } } }

function Invoke-Command1($m) {
  switch ($m.cmd) {
    'ping' { return @{ pong = $true } }
    'media' {
      $vk = $MEDIA[[string]$m.action]; if (-not $vk) { throw "Unknown media action: $($m.action)" }
      $n = [Math]::Max(1, [Math]::Min(25, [int]$m.times))
      for ($i = 0; $i -lt $n; $i++) { [Jarvis.Input]::Tap([byte]$vk); Start-Sleep -Milliseconds 15 }
      Start-Sleep -Milliseconds 120
      return (Get-Vol)
    }
    'getVolume' { return (Get-Vol) }
    'setVolume' {
      $lv = [Math]::Max(0, [Math]::Min(100, [double]$m.level))
      [Jarvis.Audio]::Volume = [float]($lv / 100)
      if ($lv -gt 0 -and [Jarvis.Audio]::Mute) { [Jarvis.Audio]::Mute = $false }
      return (Get-Vol)
    }
    'setMute' { [Jarvis.Audio]::Mute = [bool]$m.on; return (Get-Vol) }
    'nowPlaying' { return (Get-NowPlaying) }
    'windows' { return @{ windows = @(Get-Windows | Where-Object { $_.app -ne 'Jarvis' } | Select-Object -First 40) } }
    'window' {
      $w = Find-Window ([string]$m.target)
      if (-not $w) { throw "No open window matches '$($m.target)'." }
      switch ([string]$m.action) {
        'focus'    { [void][Jarvis.Win]::Focus($w.handle) }
        'minimize' { [Jarvis.Win]::Show($w.handle, 6) }
        'maximize' { [Jarvis.Win]::Show($w.handle, 3); [void][Jarvis.Win]::Focus($w.handle) }
        'restore'  { [Jarvis.Win]::Show($w.handle, 9); [void][Jarvis.Win]::Focus($w.handle) }
        'close'    { [Jarvis.Win]::Close($w.handle) }
        default    { throw "Unknown window action: $($m.action)" }
      }
      return @{ window = $w.title; app = $w.app }
    }
    'keys' {
      if ($m.target) { $w = Find-Window ([string]$m.target); if (-not $w) { throw "No open window matches '$($m.target)'." }; [void][Jarvis.Win]::Focus($w.handle); Start-Sleep -Milliseconds 250 }
      $combos = ([string]$m.keys) -split '\s*,\s*|\s+then\s+' | Where-Object { $_ }
      foreach ($c in $combos) {
        $codes = [byte[]]@(($c -split '\s*\+\s*') | ForEach-Object { Get-Vk $_ })
        $n = [Math]::Max(1, [Math]::Min(50, [int]$m.times))
        for ($i = 0; $i -lt $n; $i++) { [Jarvis.Input]::Combo($codes); Start-Sleep -Milliseconds 40 }
        Start-Sleep -Milliseconds 80
      }
      return @{ sent = $combos }
    }
    'type' {
      if ($m.target) { $w = Find-Window ([string]$m.target); if (-not $w) { throw "No open window matches '$($m.target)'." }; [void][Jarvis.Win]::Focus($w.handle); Start-Sleep -Milliseconds 250 }
      $lines = ([string]$m.text) -split "`r?`n"
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i]) { [void][Jarvis.Input]::Type($lines[$i]) }
        if ($i -lt $lines.Count - 1) { [Jarvis.Input]::Tap(0x0D) }
        Start-Sleep -Milliseconds 20
      }
      if ($m.enter) { Start-Sleep -Milliseconds 60; [Jarvis.Input]::Tap(0x0D) }
      return @{ typed = ([string]$m.text).Length }
    }
    default { throw "Unknown command: $($m.cmd)" }
  }
}

if ($SelfTest) {
  # used by the GitHub build to make sure everything compiles and runs on Windows
  $w = @(Get-Windows); Write-Output "windows: $($w.Count)"
  Write-Output ("volume: " + ((Get-Vol) | ConvertTo-Json -Compress))
  Write-Output ("now playing: " + ((Get-NowPlaying) | ConvertTo-Json -Compress))
  Write-Output ("keys parse: " + ((@('ctrl', 'shift', 's', 'f5', 'enter', 'win') | ForEach-Object { Get-Vk $_ }) -join ','))
  $r = Invoke-Command1 ([pscustomobject]@{ cmd = 'ping' }); Write-Output ("ping: " + ($r | ConvertTo-Json -Compress))
  Write-Output 'SELFTEST OK'
  exit 0
}

[Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $m = $line | ConvertFrom-Json
    $id = $m.id
    $res = Invoke-Command1 $m
    $out = @{ id = $id; ok = $true; result = $res }
  } catch {
    $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
