const PERF_LANE_FLAG_ENABLED = "1";

export interface PerfLaneRenderEnvironment {
  readonly DEV?: boolean;
  readonly VITE_CODEVO_PERF_AUTORUN?: string;
  readonly VITE_CODEVO_PERF_BRIDGE?: string;
  readonly VITE_CODEVO_PERF_PRODUCTION_CAPTURE?: string;
}

export function strictModeEnabled(
  environment: PerfLaneRenderEnvironment = import.meta.env,
): boolean {
  if (environment.DEV !== true) {
    return true;
  }

  if (environment.VITE_CODEVO_PERF_AUTORUN === PERF_LANE_FLAG_ENABLED) {
    return false;
  }

  if (environment.VITE_CODEVO_PERF_BRIDGE === PERF_LANE_FLAG_ENABLED) {
    return false;
  }

  return true;
}
