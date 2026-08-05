export const PERF_CLIENT_ENV_NAMES = Object.freeze([
  "VITE_CODEVO_PERF_AUTORUN",
  "VITE_CODEVO_PERF_BRIDGE",
  "VITE_CODEVO_PERF_PRODUCTION_CAPTURE",
  "VITE_CODEVO_PERF_WINDOW_MODE",
  "VITE_CODEVO_QA_BRIDGE",
]);

export function perfViteEnvironment({ modeEnvironment, processEnvironment }) {
  const ordinaryEnvironment = { ...modeEnvironment, ...processEnvironment };
  const ordinaryClientDefines = Object.entries(ordinaryEnvironment)
    .filter(
      ([name, value]) =>
        name.startsWith("VITE_") && !isPerfAuthorityName(name) && typeof value === "string",
    )
    .map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)]);
  const authorityClientDefines = PERF_CLIENT_ENV_NAMES.map((name) => [
    `import.meta.env.${name}`,
    JSON.stringify(explicitEnvironmentValue(processEnvironment, name)),
  ]);
  const clientDefines = Object.fromEntries([...ordinaryClientDefines, ...authorityClientDefines]);
  const productionCaptureEnabled = processEnvironment.VITE_CODEVO_PERF_PRODUCTION_CAPTURE === "1";

  return Object.freeze({
    autorunBaked: productionCaptureEnabled || processEnvironment.VITE_CODEVO_PERF_AUTORUN === "1",
    clientDefines: Object.freeze(clientDefines),
    ordinaryEnvironment: Object.freeze(ordinaryEnvironment),
    productionCaptureEnabled,
    productionCaptureRunToken: productionCaptureEnabled
      ? explicitEnvironmentValue(processEnvironment, "CODEVO_PERF_CAPTURE_RUN_TOKEN")
      : "",
    // QA/performance authority is deliberately not merged with Vite mode files.
    // A checked-in or local .env file must never arm a bridge, relay, or capture.
    trustedPerfEnvironment: processEnvironment,
  });
}

function isPerfAuthorityName(name) {
  return name === "VITE_CODEVO_QA_BRIDGE" || name.startsWith("VITE_CODEVO_PERF_");
}

function explicitEnvironmentValue(environment, name) {
  const value = environment[name];

  return typeof value === "string" ? value : "";
}
