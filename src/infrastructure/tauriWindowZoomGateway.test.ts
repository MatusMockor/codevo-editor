import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tauriWindowZoomGateway } from "./tauriWindowZoomGateway";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  setZoom: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));

const dispatchEvent = vi.fn();
const style = { zoom: "" };

beforeEach(() => {
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("document", { documentElement: { style } });
  mocks.isTauri.mockReturnValue(true);
  mocks.setZoom.mockReset().mockResolvedValue(undefined);
  dispatchEvent.mockReset();
  style.zoom = "";
});

afterEach(() => vi.unstubAllGlobals());

describe("tauriWindowZoomGateway", () => {
  it("applies native webview zoom and notifies editor and terminal layout after settlement", async () => {
    await tauriWindowZoomGateway.setScale(1.44);
    expect(mocks.setZoom).toHaveBeenCalledWith(1.44);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "resize" }));
    expect(style.zoom).toBe("");
  });

  it("applies whole-document zoom in browser previews", async () => {
    mocks.isTauri.mockReturnValue(false);
    await tauriWindowZoomGateway.setScale(1.2);
    expect(style.zoom).toBe("1.2");
    expect(mocks.setZoom).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "resize" }));
  });

  it("propagates native failures without reporting a completed layout change", async () => {
    const error = new Error("webview zoom unavailable");
    mocks.setZoom.mockRejectedValue(error);
    await expect(tauriWindowZoomGateway.setScale(1.2)).rejects.toBe(error);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
