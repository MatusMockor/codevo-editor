import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => undefined);
const windowShow = vi.fn(async () => undefined);

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show: windowShow, setBackgroundColor: vi.fn(async () => undefined) }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setBackgroundColor: vi.fn(async () => undefined) }),
}));

const { STARTUP_WINDOW_REVEAL_COMMAND, createTauriNativeWindow } =
  await import("./tauriNativeWindow");

describe("createTauriNativeWindow", () => {
  beforeEach(() => {
    invoke.mockClear();
    windowShow.mockClear();
  });

  it("reveals through the native command so the startup fallback stands down", async () => {
    const port = createTauriNativeWindow();
    expect(port).not.toBeNull();

    await port?.show();

    expect(STARTUP_WINDOW_REVEAL_COMMAND).toBe("reveal_startup_window");
    expect(invoke).toHaveBeenCalledWith("reveal_startup_window");
    expect(windowShow).not.toHaveBeenCalled();
  });
});
