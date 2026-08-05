import { describe, expect, it } from "vitest";
import { PERF_CLIENT_ENV_NAMES, perfViteEnvironment } from "./perfViteEnvironment.mjs";

describe("perfViteEnvironment", () => {
  it("does not let mode files arm QA, autorun, bridges, capture, or a capture token", () => {
    const modeEnvironment = Object.fromEntries(PERF_CLIENT_ENV_NAMES.map((name) => [name, "1"]));
    modeEnvironment.CODEVO_PERF_CAPTURE_RUN_TOKEN = "mode-file-secret";

    const result = perfViteEnvironment({ modeEnvironment, processEnvironment: {} });

    expect(result.autorunBaked).toBe(false);
    expect(result.productionCaptureEnabled).toBe(false);
    expect(result.productionCaptureRunToken).toBe("");
    expect(result.trustedPerfEnvironment).toEqual({});
    for (const name of PERF_CLIENT_ENV_NAMES) {
      expect(result.clientDefines[`import.meta.env.${name}`]).toBe(JSON.stringify(""));
    }
  });

  it("retains ordinary Vite mode values while sensitive client values use process authority", () => {
    const result = perfViteEnvironment({
      modeEnvironment: {
        TAURI_DEV_HOST: "mode-host",
        VITE_PUBLIC_THEME: "mode-theme",
        VITE_CODEVO_QA_BRIDGE: "1",
      },
      processEnvironment: {
        TAURI_DEV_HOST: "process-host",
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      },
    });

    expect(result.ordinaryEnvironment).toMatchObject({
      TAURI_DEV_HOST: "process-host",
      VITE_PUBLIC_THEME: "mode-theme",
    });
    expect(result.clientDefines["import.meta.env.VITE_PUBLIC_THEME"]).toBe('"mode-theme"');
    expect(result.autorunBaked).toBe(true);
    expect(result.clientDefines["import.meta.env.VITE_CODEVO_QA_BRIDGE"]).toBe('"1"');
    expect(result.trustedPerfEnvironment.VITE_CODEVO_PERF_AUTORUN).toBe("1");
  });

  it("takes production capture credentials only from the invoking process", () => {
    const result = perfViteEnvironment({
      modeEnvironment: {
        CODEVO_PERF_CAPTURE_RUN_TOKEN: "mode-token",
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
      },
      processEnvironment: {
        CODEVO_PERF_CAPTURE_RUN_TOKEN: "0123456789abcdef0123456789abcdef",
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
      },
    });

    expect(result.productionCaptureEnabled).toBe(true);
    expect(result.autorunBaked).toBe(true);
    expect(result.productionCaptureRunToken).toBe("0123456789abcdef0123456789abcdef");
  });
});
