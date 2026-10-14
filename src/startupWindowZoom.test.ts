import { afterEach, describe, expect, it, vi } from "vitest";
import { readBrowserStartupWindowZoomLevel } from "./startupWindowZoom";

afterEach(() => vi.unstubAllGlobals());

describe("readBrowserStartupWindowZoomLevel", () => {
  it("defaults safely when browser storage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(readBrowserStartupWindowZoomLevel()).toBe(0);
  });
});
