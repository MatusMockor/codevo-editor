export const PERF_PRODUCTION_CAPTURE_FLAG = "1";

export interface PerfProductionCaptureEnvironment {
  readonly DEV?: boolean;
  readonly VITE_CODEVO_PERF_PRODUCTION_CAPTURE?: string;
}

export function perfProductionCaptureEnabled(
  environment: PerfProductionCaptureEnvironment = import.meta.env,
): boolean {
  return (
    environment.DEV === false &&
    environment.VITE_CODEVO_PERF_PRODUCTION_CAPTURE === PERF_PRODUCTION_CAPTURE_FLAG
  );
}
