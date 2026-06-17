import { describe, expect, it, vi } from "vitest";
import { TauriLanguageServerRuntimeGateway } from "./tauriLanguageServerRuntimeGateway";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";

type RuntimeGatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerRuntimeGateway
>;
type InvokeCommand = NonNullable<RuntimeGatewayConstructor[0]>;
type ListenToEvent = NonNullable<RuntimeGatewayConstructor[1]>;

describe("TauriLanguageServerRuntimeGateway", () => {
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      listenToEvent,
      () => false,
    );

    await expect(gateway.getStatus("/workspace")).resolves.toEqual({
      kind: "stopped",
    });
    await expect(gateway.stop("/workspace")).resolves.toEqual({ kind: "stopped" });
    await expect(gateway.start("/workspace")).resolves.toEqual({
      kind: "crashed",
      message: "Language server requires the Tauri desktop runtime.",
    });

    const unsubscribe = await gateway.subscribeStatus(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates commands and status events inside Tauri", async () => {
    const running: LanguageServerRuntimeStatus = {
      kind: "running",
      sessionId: 1,
      capabilities: {
        codeAction: true,
        completion: true,
        definition: true,
        formatting: true,
        hover: true,
        implementation: true,
        references: true,
        rename: true,
      },
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => running);
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({ payload: running });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      listenToEvent,
      () => true,
    );

    await expect(gateway.getStatus("/workspace")).resolves.toEqual(running);
    await expect(gateway.start("/workspace")).resolves.toEqual(running);
    await expect(gateway.stop("/workspace")).resolves.toEqual(running);
    await gateway.subscribeStatus(listener);

    expect(invokeCommand).toHaveBeenCalledWith("get_php_language_server_status", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_php_language_server", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("stop_php_language_server", {
      rootPath: "/workspace",
    });
    expect(listenToEvent).toHaveBeenCalledWith(
      "language-server://status",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(running);
  });
});
