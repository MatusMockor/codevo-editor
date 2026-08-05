import { describe, expect, it } from "vitest";
import { strictModeEnabled } from "./perfLaneRenderMode";

describe("strictModeEnabled", () => {
  it("keeps StrictMode in a normal dev session without perf flags", () => {
    expect(strictModeEnabled({ DEV: true })).toBe(true);
  });

  it("disables StrictMode when the dev autorun perf lane is active", () => {
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_AUTORUN: "1" })).toBe(false);
  });

  it("disables StrictMode when the dev perf bridge lane is active", () => {
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" })).toBe(false);
  });

  it("disables StrictMode when both dev perf flags are active", () => {
    expect(
      strictModeEnabled({
        DEV: true,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
      }),
    ).toBe(false);
  });

  it("keeps StrictMode in production even when both perf flags are set", () => {
    expect(
      strictModeEnabled({
        DEV: false,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
      }),
    ).toBe(true);
  });

  it("keeps production render semantics in the instrumented capture build", () => {
    expect(strictModeEnabled({ DEV: false, VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1" })).toBe(true);
  });

  it("keeps StrictMode when DEV is absent even with perf flags set", () => {
    expect(strictModeEnabled({ VITE_CODEVO_PERF_AUTORUN: "1", VITE_CODEVO_PERF_BRIDGE: "1" })).toBe(
      true,
    );
  });

  it("keeps StrictMode for perf flag values other than the exact opt-in", () => {
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_AUTORUN: "true" })).toBe(true);
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: "true" })).toBe(true);
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_AUTORUN: "0" })).toBe(true);
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: "0" })).toBe(true);
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_AUTORUN: "" })).toBe(true);
    expect(strictModeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: undefined })).toBe(true);
  });

  it("keeps StrictMode for an empty environment", () => {
    expect(strictModeEnabled({})).toBe(true);
  });
});
