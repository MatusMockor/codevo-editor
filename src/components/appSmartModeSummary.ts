import type { LanguageServerPlan } from "../domain/languageServer";
import {
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { IntelligenceMode } from "../domain/workspace";

export function smartModeSummary(
  workspaceRoot: string | null,
  mode: IntelligenceMode,
  runtimeStatus: LanguageServerRuntimeStatus | null,
  plan: LanguageServerPlan | null,
  trusted: boolean,
): string {
  if (!workspaceRoot) return "No workspace";

  if (mode === "basic") {
    return "Lightweight";
  }

  if (mode === "lightSmart") {
    return "Smart Index";
  }

  if (!trusted) {
    return "Untrusted";
  }

  const runtimeLabel = languageServerStatusLabel(runtimeStatus, "PHPactor", {
    workspaceRoot,
  });

  if (runtimeLabel) {
    return runtimeLabel;
  }

  if (plan?.status === "ready") {
    return "IDE ready";
  }

  return "IDE setup needed";
}
