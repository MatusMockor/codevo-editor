import type { DebugCopyStackTraceCommand } from "../DebugPanel";

export function canCopyStackTrace(command: DebugCopyStackTraceCommand | undefined): boolean {
  try {
    return command?.canCopyStackTrace() === true;
  } catch {
    return false;
  }
}
