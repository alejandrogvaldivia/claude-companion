// Vigilante de Claude Desktop para Claude Companion.
// Imprime (solo cuando cambia):
//   "1" / "0"   Claude Desktop abierto / cerrado.
//   "F1" / "F0" hay una ventana en pantalla completa en la pantalla principal (un video, un juego…) / ya no.
//   "A1" / "A0" la barra de tareas está en "ocultar automáticamente" / ya no.
//   "T<n>/<m>"  (solo con "ocultar automáticamente") cuánto se ve de la barra: n px de m de alto de pantalla.
// Además mantiene las ventanas de los Clawds siempre encima y sin minimizar (Windows se lo quita al activar otra ventana
// o con "minimizar todo"; Electron no lo puede volver a poner).
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

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    static uint ownerPid = 0;                                   // el proceso de Claude Companion que me abrió (0 = cualquiera con ese título)

    // las ventanas de los Clawds: siempre encima de todo y nunca minimizadas
    static void KeepOnTop()
    {
        try
        {
            EnumWindows((h, l) =>
            {
                var title = new StringBuilder(64);
                GetWindowText(h, title, 64);
                if (title.ToString() != "Claude Companion") return true;
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (ownerPid != 0 && pid != ownerPid) return true;
                if (IsIconic(h)) ShowWindow(h, 4 /* SW_SHOWNOACTIVATE: se restaura sin quitarle el foco a nadie */);
                if ((GetWindowLong(h, -20 /* GWL_EXSTYLE */) & 0x8 /* WS_EX_TOPMOST */) == 0)
                    SetWindowPos(h, new IntPtr(-1) /* HWND_TOPMOST */, 0, 0, 0, 0, 0x13 /* sin mover, sin cambiar tamaño, sin activar */);
                return true;
            }, IntPtr.Zero);
        }
        catch { }
    }

    // ¿lo que se ve arriba en la pantalla principal es una ventana en pantalla completa (un video, un juego…)?
    // Se mira la ventana que está más arriba EN ESA PANTALLA, no la que tiene el foco: si el video sigue en pantalla completa
    // pero haces clic en otra ventana (por ejemplo en otro monitor), los Clawds se quedan abajo.
    static bool Fullscreen()
    {
        try
        {
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(MonitorFromPoint(new POINT(), 1 /* MONITOR_DEFAULTTOPRIMARY */), ref mi)) return false;
            RECT m = mi.rcMonitor;
            bool result = false;
            EnumWindows((h, l) =>                                  // de arriba hacia abajo en el orden de las ventanas
            {
                if (!IsWindowVisible(h) || IsIconic(h)) return true;
                int cloaked;
                if (DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out cloaked, 4) == 0 && cloaked != 0) return true;   // ventanas "escondidas" de Windows
                var cls = new StringBuilder(64);
                GetClassName(h, cls, 64);
                string c = cls.ToString();
                if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;   // el escritorio y la barra
                var title = new StringBuilder(64);
                GetWindowText(h, title, 64);
                if (title.ToString() == "Claude Companion") return true;                                                      // los propios Clawds
                RECT r;
                if (!GetWindowRect(h, out r)) return true;
                if (r.Right - r.Left < 40 || r.Bottom - r.Top < 20) return true;
                int ix = Math.Min(r.Right, m.Right) - Math.Max(r.Left, m.Left);
                int iy = Math.Min(r.Bottom, m.Bottom) - Math.Max(r.Top, m.Top);
                // que no sea de otra pantalla (los bordes de una ventana vecina se asoman unos px): debe cubrir al menos 1/4 de ésta
                if (ix <= 0 || iy <= 0 || (long)ix * iy * 4 < (long)(m.Right - m.Left) * (m.Bottom - m.Top)) return true;
                // la primera ventana que se ve en la pantalla principal decide
                // (un video en pantalla completa sigue "maximizado" para Windows, así que eso no cuenta: lo que importa es que cubra
                // TODA la pantalla; una ventana maximizada normal deja la barra de tareas. Con la barra oculta sola ya bajan por A1)
                result = r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
                return false;
            }, IntPtr.Zero);
            return result;
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

    static void Main(string[] args)
    {
        if (args.Length > 0) { uint.TryParse(args[0], out ownerPid); }
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
            if (tick % 3 == 0) KeepOnTop();          // ventanas de los Clawds: cada 0.3 s
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
