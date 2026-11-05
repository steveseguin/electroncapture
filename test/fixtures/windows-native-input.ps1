param(
    [ValidateSet('probe', 'click', 'drag')][string]$Action,
    [long]$WindowHandle, [int]$OwnerProcess,
    [int]$X, [int]$Y, [int]$EndX, [int]$EndY
)
$ErrorActionPreference = 'Stop'
# Native input, restricted to the fixture's own window and process.
# https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-sendinput
# https://learn.microsoft.com/windows/win32/inputdev/wm-nchittest
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class FixtureInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput {
    public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public MouseInput mouse; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(
    IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  public static long RootAt(int x, int y) {
    return GetAncestor(WindowFromPoint(new Point { X=x, Y=y }), 2).ToInt64();
  }
  public static long HitTest(long window, int x, int y) {
    UIntPtr result;
    long packed = (uint)(x & 0xffff) | ((uint)(y & 0xffff) << 16);
    if (SendMessageTimeout(new IntPtr(window), 0x84, UIntPtr.Zero, new IntPtr(packed), 2, 1000, out result) == IntPtr.Zero)
      throw new Exception("Fixture hit test timed out");
    return unchecked((int)result.ToUInt64());
  }
  static void Button(uint flags) {
    Input[] inputs = { new Input { type=0, mouse=new MouseInput { flags=flags } } };
    if (SendInput(1, inputs, Marshal.SizeOf(typeof(Input))) != 1) throw new Exception("SendInput failed");
  }
  public static void Perform(string action, long window, uint owner, int x, int y, int endX, int endY) {
    uint actualOwner;
    GetWindowThreadProcessId(new IntPtr(window), out actualOwner);
    if (actualOwner != owner || RootAt(x,y) != window) throw new Exception("Fixture is covered or no longer owns input; refusing injection");
    if ((GetAsyncKeyState(1) & 0x8000) != 0) throw new Exception("Mouse button already held; refusing injection");
    Point original;
    if (!GetCursorPos(out original)) throw new Exception("No interactive cursor");
    bool down=false;
    try {
      if (!SetCursorPos(x,y)) throw new Exception("Cannot position fixture cursor");
      Thread.Sleep(40);
      if (RootAt(x,y) != window) throw new Exception("Fixture ownership changed; refusing injection");
      Button(2); down=true;
      Thread.Sleep(50);
      if (action == "drag") {
        for (int step=1; step<=12; step++) {
          if (!SetCursorPos(x+(endX-x)*step/12, y+(endY-y)*step/12)) throw new Exception("Cannot drag fixture cursor");
          Thread.Sleep(25);
        }
      }
      Button(4); down=false;
    } finally {
      if (down) Button(4);
      SetCursorPos(original.X,original.Y);
    }
  }
}
'@
[FixtureInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$root = [FixtureInput]::RootAt($X,$Y)
$hit = [FixtureInput]::HitTest($WindowHandle,$X,$Y)
if ($Action -ne 'probe') { [FixtureInput]::Perform($Action,$WindowHandle,$OwnerProcess,$X,$Y,$EndX,$EndY) }
@{root=$root;hit=$hit;action=$Action} | ConvertTo-Json -Compress
