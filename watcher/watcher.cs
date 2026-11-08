// Vigilante de Claude Desktop para Claude Companion.
// Imprime "1" cuando Claude Desktop está abierto y "0" cuando se cierra (solo cuando cambia).
// Distingue Claude Desktop (carpeta AnthropicClaude o paquete de la Store) de las sesiones de
// Claude Code, que también se llaman claude.exe. Se cierra solo si la app que lo abrió se cierra.
using System;
using System.Diagnostics;
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

    static void Main()
    {
        var guard = new Thread(() => {
            try { while (Console.In.Read() != -1) { } } catch { }
            Environment.Exit(0);
        });
        guard.IsBackground = true;
        guard.Start();

        int last = -1;
        while (true)
        {
            int now = Running() ? 1 : 0;
            if (now != last)
            {
                Console.Out.WriteLine(now);
                Console.Out.Flush();
                last = now;
            }
            Thread.Sleep(2000);
        }
    }
}
