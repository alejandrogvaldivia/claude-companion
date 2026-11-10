// Vigilante de Claude Desktop para Claude Companion.
// Imprime (solo cuando cambia):
//   "1" / "0"   Claude Desktop abierto / cerrado.
//   "F1" / "F0" hay una ventana en pantalla completa en la pantalla principal (un video, un juego…) / ya no.
//   "A1" / "A0" la barra de tareas está en "ocultar automáticamente" / ya no.
//   "T<n>/<m>"  (solo con "ocultar automáticamente") cuánto se ve de la barra: n px de m de alto de pantalla.
// Con F1 o A1 los Clawds de la barra de tareas bajan hasta la orilla de la pantalla.
// Distingue Claude Desktop (carpeta AnthropicClaude o paquete de la Store) de las sesiones de
// Claude Code, que también se llaman claude.exe. Se cierra solo si la app que lo abrió se cierra.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class ClaudeWatcher
{
    static int knownPid = -1;

    static bool IsDesktop(Process p)
    {
        try
        {
            string f = p.MainModule.FileName;
            return f.IndexOf("\\AnthropicClaude\\", StringComparison.OrdinalIgnoreCase) >= 0
                || (f.IndexOf("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase) >= 0
                    && f.IndexOf("Claude", StringComparison.OrdinalIgnoreCase) >= 0);
        }
        catch { return false; }
    }

    static bool Running()
    {
        if (knownPid > 0)
        {
            try
            {
                using (var p = Process.GetProcessById(knownPid))
                    if (!p.HasExited && IsDesktop(p)) return true;
            }
            catch { }
            knownPid = -1;
        }
        foreach (var p in Process.GetProcessesByName("claude"))
        {
            try { if (IsDesktop(p)) { knownPid = p.Id; return true; } }
            finally { p.Dispose(); }
        }
        return false;
    }

    // ---------- pantalla completa y barra de tareas oculta ----------
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage, uEdge; public RECT rc; public IntPtr lParam; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);

    // barra de tareas abajo con "ocultar automáticamente": cuánto asoma ahora (0 = escondida)
    static string TrayShown()
    {
        try
        {
            IntPtr t = FindWindow("Shell_TrayWnd", null);
            RECT r;
            if (t == IntPtr.Zero || !GetWindowRect(t, out r)) return null;
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            // siempre la pantalla principal (la barra escondida asoma hacia la de abajo, si la hay)
            if (!GetMonitorInfo(MonitorFromPoint(new POINT(), 1 /* MONITOR_DEFAULTTOPRIMARY */), ref mi)) return null;
            int monH = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
            if (r.Top < mi.rcMonitor.Top + monH / 2) return null;            // no está abajo
            int shown = Math.Max(0, Math.Min(r.Bottom - r.Top, mi.rcMonitor.Bottom - r.Top));
            if (shown <= 4) shown = 0;                                        // escondida (deja 2 px)
            return shown + "/" + monH;
        }
        catch { return null; }
    }

    static bool Fullscreen()
    {
        try
        {
            IntPtr h = GetForegroundWindow();
            if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;
            var cls = new StringBuilder(64);
            GetClassName(h, cls, 64);
            string c = cls.ToString();
            if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;   // el escritorio y la barra
            RECT r;
            if (IsZoomed(h)) return false;            // maximizada no es pantalla completa (con la barra oculta ocupa todo)
            if (!GetWindowRect(h, out r)) return false;
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
            if ((mi.dwFlags & 1) == 0) return false;   // solo la pantalla principal (ahí viven los Clawds)
            return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
        }
        catch { return false; }
    }

    static bool AutoHide()
    {
        try
        {
            var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
            return ((uint)SHAppBarMessage(4 /* ABM_GETSTATE */, ref d) & 1 /* ABS_AUTOHIDE */) != 0;
        }
        catch { return false; }
    }

    static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

    static void Main()
    {
        var guard = new Thread(() => {
            try { while (Console.In.Read() != -1) { } } catch { }
            Environment.Exit(0);
        });
        guard.IsBackground = true;
        guard.Start();

        int last = -1, lastF = -1, lastA = -1;
        string lastT = null;
        for (int tick = 0; ; tick++)
        {
            if (tick % 20 == 0)                      // Claude: cada 2 s
            {
                int now = Running() ? 1 : 0;
                if (now != last) { Say(now.ToString()); last = now; }
            }
            if (tick % 5 == 0)                       // pantalla completa: cada medio segundo
            {
                int f = Fullscreen() ? 1 : 0;
                if (f != lastF) { Say("F" + f); lastF = f; }
            }
            if (tick % 20 == 0)
            {
                int a = AutoHide() ? 1 : 0;
                if (a != lastA) { Say("A" + a); lastA = a; lastT = null; }
            }
            if (lastA == 1)                          // barra que se oculta sola: dónde va (10 veces por segundo)
            {
                string t = TrayShown();
                if (t != null && t != lastT) { Say("T" + t); lastT = t; }
            }
            Thread.Sleep(100);
        }
    }
}
