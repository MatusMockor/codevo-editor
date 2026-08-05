/// <reference types="vite/client" />

declare const __CODEVO_PERF_CAPTURE_RUN_TOKEN__: string;
declare const __CODEVO_PERF_AUTORUN_BAKED__: boolean;

declare module "virtual:codevo-perf-production-runner" {
  const run: (options: unknown) => Promise<unknown>;
  export const perfAutorunOptions: unknown;
  export const perfAutorunRunToken: string;
  export default run;
}
