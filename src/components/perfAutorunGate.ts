import { editorQaBridgeEnabled } from "./editorQaBridge";
import { perfProductionCaptureEnabled } from "./perfProductionCapture";
import { perfScenarioBridgeEnabled } from "./perfScenarioBridge";

export interface PerfAutorunEnvironment {
  DEV?: boolean;
  VITE_CODEVO_PERF_AUTORUN?: string;
  VITE_CODEVO_PERF_BRIDGE?: string;
  VITE_CODEVO_QA_BRIDGE?: string;
  VITE_CODEVO_PERF_WINDOW_MODE?: string;
  VITE_CODEVO_PERF_PRODUCTION_CAPTURE?: string;
}

export function perfAutorunEnabled(
  environment: PerfAutorunEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null | undefined = window.localStorage,
): boolean {
  if (perfProductionCaptureEnabled(environment)) {
    return (
      perfScenarioBridgeEnabled(environment, storage) && editorQaBridgeEnabled(environment, storage)
    );
  }

  if (!environment.DEV || environment.VITE_CODEVO_PERF_AUTORUN !== "1") {
    return false;
  }

  return (
    perfScenarioBridgeEnabled(environment, storage) && editorQaBridgeEnabled(environment, storage)
  );
}
