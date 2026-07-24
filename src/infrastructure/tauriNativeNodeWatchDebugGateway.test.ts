import { describe, expect, it, vi } from "vitest";
import type { NativeNodeWatchDebugStartRequest } from "../domain/nativeNodeWatchDebugGateway";
import { TauriDebugGateway } from "./tauriDebugGateway";

type InvokeCommand = NonNullable<ConstructorParameters<typeof TauriDebugGateway>[0]>;

const request: NativeNodeWatchDebugStartRequest = {
  rootPath: "/workspace",
  scriptPath: "/workspace/server.js",
  watch: true,
  breakpoints: [],
  exceptionPauseMode: "none",
};

describe("TauriDebugGateway native Node watch seam", () => {
  it("does not cross IPC outside the desktop runtime", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => false);

    await expect(gateway.startNativeNodeWatch(request)).resolves.toEqual({
      kind: "unavailable",
      message: "Debugging requires the Tauri desktop runtime.",
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("clones breakpoints and maps the existing start response", async () => {
    const invokeCommand = vi.fn<InvokeCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 23,
    });
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const breakpoints = [
      {
        id: "entry",
        filePath: "/workspace/server.js",
        lineNumber: 3,
        enabled: true,
      },
    ];

    await expect(gateway.startNativeNodeWatch({ ...request, breakpoints })).resolves.toEqual({
      kind: "ok",
      sessionId: 23,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start_native_node_watch", {
      ...request,
      breakpoints,
    });
    expect(invokeCommand.mock.calls[0]?.[1]?.breakpoints).not.toBe(breakpoints);
  });

  it("confirms only the exact paused session through the dedicated command", async () => {
    const invokeCommand = vi.fn<InvokeCommand>().mockResolvedValue(undefined);
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await expect(gateway.confirmNativeNodeWatch("/workspace", 23)).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_confirm_native_node_watch", {
      rootPath: "/workspace",
      sessionId: 23,
    });
  });
});
