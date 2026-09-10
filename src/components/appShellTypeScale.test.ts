import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_THREAD_FONT_SIZE,
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
} from "../domain/agentSettings";
import { AGENT_TYPE_SCALE_VARIABLE, appShellTypeScaleStyle } from "./appShellTypeScale";

function scaleOf(size: unknown): unknown {
  return (appShellTypeScaleStyle(size) as Record<string, unknown>)[AGENT_TYPE_SCALE_VARIABLE];
}

describe("appShellTypeScaleStyle", () => {
  it("publishes the type scale on the shell custom property", () => {
    expect(AGENT_TYPE_SCALE_VARIABLE).toBe("--codevo-fs-scale");
    expect(scaleOf(DEFAULT_AGENT_THREAD_FONT_SIZE)).toBe("1");
  });

  it("keeps the published scale inside the supported bounds", () => {
    expect(scaleOf(MIN_AGENT_THREAD_FONT_SIZE)).toBe("0.8");
    expect(scaleOf(MAX_AGENT_THREAD_FONT_SIZE)).toBe("1.333");
    expect(scaleOf(9_000)).toBe("1.333");
    expect(scaleOf(-9_000)).toBe("0.8");
  });

  it("falls back to the unscaled ladder for a malformed preference", () => {
    expect(scaleOf(undefined)).toBe("1");
    expect(scaleOf("18")).toBe("1");
    expect(scaleOf(Number.NaN)).toBe("1");
  });

  it("preserves the layout variables it is composed onto", () => {
    const style = appShellTypeScaleStyle(20, {
      "--sidebar-width": "300px",
    } as Record<string, string>);

    expect(style).toEqual({
      "--sidebar-width": "300px",
      "--codevo-fs-scale": "1.333",
    });
  });
});
