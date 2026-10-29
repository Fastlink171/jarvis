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
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    public static void Click(int x, int y, bool right) {
      POINT old; GetCursorPos(out old);
      SetCursorPos(x, y);
      System.Threading.Thread.Sleep(30);
      mouse_event(right ? 0x0008u : 0x0002u, 0, 0, 0, UIntPtr.Zero);
      mouse_event(right ? 0x0010u : 0x0004u, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(30);
      SetCursorPos(old.X, old.Y);
    }
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
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    public static bool IsFullscreen(long handle) {
      var h = new IntPtr(handle);
      if (h == IntPtr.Zero || h == GetShellWindow() || h == GetDesktopWindow()) return false;
      RECT r; if (!GetWindowRect(h, out r)) return false;
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    }
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

[void][Jarvis.Input]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$UIA = [System.Windows.Automation.AutomationElement]
$script:uiEls = New-Object System.Collections.ArrayList
$script:uiWin = $null
$CLICKABLE = 'Button|MenuItem|Hyperlink|ListItem|TabItem|CheckBox|RadioButton|ComboBox|TreeItem|SplitButton|DataItem'

function Get-Root([string]$target) {
  if (-not $target) { $h = [Jarvis.Win]::Foreground(); return @{ el = $UIA::FromHandle([IntPtr]$h); title = ''; app = '' } }
  $w = Find-Window $target
  if (-not $w) { throw "No open window matches '$target'." }
  return @{ el = $UIA::FromHandle([IntPtr]$w.handle); title = $w.title; app = $w.app; handle = $w.handle; minimized = $w.minimized }
}
function Get-Val($el) {
  try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $v = $vp.Current.Value; if ($v) { return $v.Substring(0, [Math]::Min(200, $v.Length)) } } catch {}
  return $null
}
# Walks a window's accessibility tree (works for windows behind others) and numbers the useful elements.
function Read-UI([string]$target, [int]$max = 160) {
  $root = Get-Root $target
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $q = New-Object System.Collections.Queue; $q.Enqueue(@($root.el, 0))
  $script:uiEls = New-Object System.Collections.ArrayList; $script:uiWin = $target
  $items = New-Object System.Collections.ArrayList
  $sw = [Diagnostics.Stopwatch]::StartNew(); $seen = 0
  while ($q.Count -gt 0 -and $items.Count -lt $max -and $sw.ElapsedMilliseconds -lt 5000) {
    $pair = $q.Dequeue(); $el = $pair[0]; $d = $pair[1]; $seen++
    try { $c = $el.Current } catch { continue }
    $type = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '')
    $name = ($c.Name -replace '\s+', ' ').Trim(); if ($name.Length -gt 120) { $name = $name.Substring(0, 120) + '…' }
    $val = $null; if ($type -match '^(Edit|Document|ComboBox|Slider|ProgressBar)$') { $val = Get-Val $el }
    $useful = ($d -gt 0) -and (($name -and $type -notmatch '^(Pane|Group|Custom|Window|TitleBar|ScrollBar|Thumb|Separator|Image)$') -or ($type -match '^(Edit|Document)$') -or ($type -match $CLICKABLE -and $name))
    if ($useful) {
      [void]$script:uiEls.Add($el)
      $it = [ordered]@{ n = $script:uiEls.Count; type = $type; name = $name }
      if ($val) { $it.value = $val }
      if (-not $c.IsEnabled) { $it.disabled = $true }
      [void]$items.Add($it)
    }
    if ($d -lt 30) {
      try { $ch = $walker.GetFirstChild($el); while ($ch) { $q.Enqueue(@($ch, ($d + 1))); $ch = $walker.GetNextSibling($ch) } } catch {}
    }
  }
  return @{ window = $root.title; app = $root.app; minimized = $root.minimized; elements = @($items); truncated = ($q.Count -gt 0) }
}
function Find-UI([string]$target, $element) {
  $s = [string]$element
  if ($s -match '^\d+$' -and $script:uiWin -eq $target -and [int]$s -ge 1 -and [int]$s -le $script:uiEls.Count) { return $script:uiEls[[int]$s - 1] }
  $root = Get-Root $target
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $q = New-Object System.Collections.Queue; $q.Enqueue($root.el)
  $want = $s.ToLower().Trim(); $partial = $null; $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($q.Count -gt 0 -and $sw.ElapsedMilliseconds -lt 5000) {
    $el = $q.Dequeue()
    try { $c = $el.Current; $n = ([string]$c.Name).ToLower().Trim(); $t = $c.ControlType.ProgrammaticName } catch { continue }
    if ($n) {
      if ($n -eq $want -and $t -match $CLICKABLE) { return $el }
      if (-not $partial -and $n.Contains($want)) { $partial = $el }
    }
    try { $ch = $walker.GetFirstChild($el); while ($ch) { $q.Enqueue($ch); $ch = $walker.GetNextSibling($ch) } } catch {}
  }
  if ($partial) { return $partial }
  throw "Couldn't find '$s' in that window. Read the window again to see what's there."
}
function Click-UI([string]$target, $element, [bool]$right) {
  $el = Find-UI $target $element
  $name = ''; try { $name = $el.Current.Name } catch {}
  if (-not $right) {
    foreach ($pt in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.ExpandCollapsePattern]::Pattern)) {
      $p = $null; try { $p = $el.GetCurrentPattern($pt) } catch {}
      if ($p) {
        try {
          if ($p -is [System.Windows.Automation.InvokePattern]) { $p.Invoke() }
          elseif ($p -is [System.Windows.Automation.TogglePattern]) { $p.Toggle() }
          elseif ($p -is [System.Windows.Automation.SelectionItemPattern]) { $p.Select() }
          else { if ($p.Current.ExpandCollapseState -eq 'Expanded') { $p.Collapse() } else { $p.Expand() } }
          return @{ clicked = $name; how = 'direct' }
        } catch {}
      }
    }
  }
  # fall back to a real mouse click: bring the window forward and click the middle of the element
  if ($target) { $w = Find-Window $target; if ($w) { [void][Jarvis.Win]::Focus($w.handle); Start-Sleep -Milliseconds 300 } }
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0) { throw "'$name' isn't visible on screen, so it can't be clicked." }
  [Jarvis.Input]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2), $right)
  return @{ clicked = $name; how = 'mouse' }
}
function Set-UIText([string]$target, $element, [string]$text, [bool]$enter) {
  $el = Find-UI $target $element
  $done = $false
  try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $vp.SetValue($text); $done = $true } catch {}
  if (-not $done -or $enter) {
    if ($target) { $w = Find-Window $target; if ($w) { [void][Jarvis.Win]::Focus($w.handle); Start-Sleep -Milliseconds 250 } }
    try { $el.SetFocus() } catch {}
    Start-Sleep -Milliseconds 120
    if (-not $done) { [Jarvis.Input]::Combo([byte[]]@(0x11, 0x41)); [void][Jarvis.Input]::Type($text) }
    if ($enter) { Start-Sleep -Milliseconds 60; [Jarvis.Input]::Tap(0x0D) }
  }
  return @{ set = $text.Length }
}
function Get-Foreground {
  $h = [Jarvis.Win]::Foreground()
  $w = Get-Windows | Where-Object { $_.handle -eq $h } | Select-Object -First 1
  return @{ app = $w.app; title = $w.title; fullscreen = [Jarvis.Win]::IsFullscreen($h) }
}

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
    'uiRead' { return (Read-UI ([string]$m.target) ([int]$(if ($m.max) { $m.max } else { 160 }))) }
    'uiClick' { return (Click-UI ([string]$m.target) $m.element ([bool]$m.right)) }
    'uiSetText' { return (Set-UIText ([string]$m.target) $m.element ([string]$m.text) ([bool]$m.enter)) }
    'foreground' { return (Get-Foreground) }
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
  Write-Output ("foreground: " + ((Get-Foreground) | ConvertTo-Json -Compress))
  # open a small test window (button + text box) in another process, then drive it through accessibility
  $form = 'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = ''JarvisTestWindow''; $f.Width = 400; $f.Height = 200; $t = New-Object Windows.Forms.TextBox; $t.Name = ''box''; $t.AccessibleName = ''Message box''; $t.Top = 10; $t.Left = 10; $t.Width = 300; $b = New-Object Windows.Forms.Button; $b.Text = ''Press me''; $b.Top = 50; $b.Left = 10; $b.Width = 120; $b.Add_Click({ $f.Text = ''JarvisTestWindow pressed '' + $t.Text }); $f.Controls.Add($t); $f.Controls.Add($b); [void]$f.ShowDialog()'
  $tp = Start-Process powershell -ArgumentList '-NoProfile', '-Command', $form -PassThru; Start-Sleep -Seconds 3
  try {
    $tw = Find-Window 'JarvisTestWindow'; Write-Output ("tw: " + ($tw | ConvertTo-Json -Compress))
    $te = $UIA::FromHandle([IntPtr]$tw.handle); Write-Output ("te: '" + $te.Current.Name + "' class=" + $te.Current.ClassName + " fw=" + $te.Current.FrameworkId + " pid=" + $te.Current.ProcessId)
    $d1 = $te.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); Write-Output ("te descendants: " + $d1.Count + " -> " + (($d1 | ForEach-Object { ($_.Current.ControlType.ProgrammaticName -replace 'ControlType\.','') + ':' + $_.Current.Name }) -join ', '))
    $byName = $UIA::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($UIA::NameProperty, 'JarvisTestWindow'))); Write-Output ("via root: " + $(if ($byName) { ($byName.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)).Count } else { 'not found' }))
    Write-Output ("apartment: " + [Threading.Thread]::CurrentThread.GetApartmentState() + " elevated: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) + " session: " + (Get-Process -Id $PID).SessionId + " test session: " + (Get-Process -Id $tp.Id).SessionId)
    $ui = Read-UI 'JarvisTestWindow' 60; Write-Output ("test window elements: " + (($ui.elements | ForEach-Object { "[$($_.n)] $($_.type) '$($_.name)'" }) -join '; '))
    $st = Set-UIText 'JarvisTestWindow' 'Message box' 'hello' $false; Write-Output ("set text: " + ($st | ConvertTo-Json -Compress))
    $c = Click-UI 'JarvisTestWindow' 'Press me' $false; Write-Output ("click: " + ($c | ConvertTo-Json -Compress))
    Start-Sleep -Milliseconds 800
    $after = (Get-Windows | Where-Object { $_.title -like 'JarvisTestWindow*' } | Select-Object -First 1).title; Write-Output "title after click: $after"
    if ($after -eq 'JarvisTestWindow pressed hello') { Write-Output 'UIA OK' } else { Write-Output 'UIA FAILED' }
  } catch { Write-Output "UIA FAILED: $($_.Exception.Message)" }
  Stop-Process -Id $tp.Id -Force -ErrorAction SilentlyContinue
  if ($script:uiOk -eq $false) { }
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
