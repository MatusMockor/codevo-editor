import { describe, expect, it, vi } from "vitest";
import {
  ACKNOWLEDGE_JS_TEST_WATCH_START_IPC_COMMAND,
  invokeAcknowledgeJsTestWatchStartIpc,
  invokeStartJsTestWatchIpc,
  invokeStopJsTestWatchIpc,
  JS_TEST_WATCH_OUTPUT_EVENT,
  JS_TEST_WATCH_STATUS_EVENT,
  START_JS_TEST_WATCH_IPC_COMMAND,
  STOP_JS_TEST_WATCH_IPC_COMMAND,
} from "./tauriJsTestWatchIpcContract";

const owner = {
  watchId: "watch-1",
  workspaceId: "workspace-1",
  epoch: 3,
} as const;

const request = {
  ...owner,
  command: {
    kind: "vitest-watch",
    packageRootRelativePath: "",
    scope: { kind: "all" },
  },
} as const;

const result = {
  owner,
  structuredResults: "unavailable-in-watch-mode",
} as const;

describe("JavaScript test watch IPC contract", () => {
  it("keeps exact command and event names", () => {
    expect(START_JS_TEST_WATCH_IPC_COMMAND).toBe("workspace_start_js_test_watch");
    expect(ACKNOWLEDGE_JS_TEST_WATCH_START_IPC_COMMAND).toBe(
      "workspace_acknowledge_js_test_watch_start",
    );
    expect(STOP_JS_TEST_WATCH_IPC_COMMAND).toBe("workspace_stop_js_test_watch");
    expect(JS_TEST_WATCH_STATUS_EVENT).toBe("js-test-watch://status");
    expect(JS_TEST_WATCH_OUTPUT_EVENT).toBe("js-test-watch://output");
  });

  it("starts with only the strict semantic request and exact echoed owner", async () => {
    const invoke = vi.fn(async () => result);
    await expect(invokeStartJsTestWatchIpc(invoke, request)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("workspace_start_js_test_watch", { request });
  });

  it("rejects malformed requests before transport and foreign results", async () => {
    const invoke = vi.fn(async () => result);
    await expect(
      invokeStartJsTestWatchIpc(invoke, {
        ...request,
        command: { ...request.command, rawCommand: "vitest --watch" },
      } as never),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      invokeStartJsTestWatchIpc(
        vi.fn(async () => ({
          ...result,
          owner: { ...owner, epoch: owner.epoch + 1 },
        })),
        request,
      ),
    ).rejects.toThrow("requested owner");
    await expect(
      invokeStartJsTestWatchIpc(
        vi.fn(async () => ({ ...result, unknown: true })),
        request,
      ),
    ).rejects.toThrow(TypeError);
  });

  it("acknowledges and stops through exact generation owners", async () => {
    const invoke = vi.fn(async () => null);
    await invokeAcknowledgeJsTestWatchStartIpc(invoke, owner);
    await invokeStopJsTestWatchIpc(invoke, owner);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_acknowledge_js_test_watch_start", {
      request: owner,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_stop_js_test_watch", { request: owner });
    await expect(
      invokeStopJsTestWatchIpc(
        vi.fn(async () => ({})),
        owner,
      ),
    ).rejects.toThrow("result");
    await expect(
      invokeStopJsTestWatchIpc(
        vi.fn(async () => null),
        { ...owner, unknown: true } as never,
      ),
    ).rejects.toThrow(TypeError);
  });
});
