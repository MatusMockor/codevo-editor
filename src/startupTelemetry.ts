const LOG_STARTUP_SHELL_PAINT_COMMAND = "log_startup_shell_painted";

type StartupInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function logStartupShellPaint(
  rendererElapsedMs: number,
  paintEpochMs: number,
  loadInvoke: () => Promise<StartupInvoke> = loadTauriInvoke,
): void {
  if (
    !Number.isFinite(rendererElapsedMs) ||
    rendererElapsedMs < 0 ||
    !Number.isFinite(paintEpochMs) ||
    paintEpochMs < 0
  ) {
    return;
  }

  void loadInvoke()
    .then((invokeCommand) =>
      invokeCommand(LOG_STARTUP_SHELL_PAINT_COMMAND, {
        paintEpochMs,
        rendererElapsedMs,
      }),
    )
    .catch(() => {
      // Browser-only tests and previews have no native runtime. Evidence-only
      // telemetry must never prevent the editor from mounting.
    });
}

async function loadTauriInvoke(): Promise<StartupInvoke> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}
