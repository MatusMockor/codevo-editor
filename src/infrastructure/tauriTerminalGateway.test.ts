import { describe, expect, it, vi } from "vitest";
import { TauriTerminalGateway } from "./tauriTerminalGateway";
import type { TerminalOutputEvent } from "../domain/terminal";

type TerminalGatewayConstructor = ConstructorParameters<
  typeof TauriTerminalGateway
>;
type InvokeCommand = NonNullable<TerminalGatewayConstructor[0]>;
type ListenToEvent = NonNullable<TerminalGatewayConstructor[1]>;

describe("TauriTerminalGateway", () => {
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriTerminalGateway(
      invokeCommand,
      listenToEvent,
      () => false,
    );

    await expect(gateway.start("/workspace", { cols: 80, rows: 24 })).rejects.toThrow(
      "Terminal requires the Tauri desktop runtime.",
    );
    await expect(gateway.listProfiles()).resolves.toEqual([]);
    await expect(gateway.writeInput(1, "ls\r")).resolves.toBeUndefined();
    await expect(
      gateway.resize(1, { cols: 100, rows: 30 }),
    ).resolves.toBeUndefined();
    await expect(gateway.stop(1)).resolves.toEqual({
      kind: "stopped",
      sessionId: 1,
    });

    const unsubscribe = await gateway.subscribeOutput(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates terminal commands and output events inside Tauri", async () => {
    const running = {
      cols: 80,
      cwd: "/workspace",
      kind: "running" as const,
      rows: 24,
      sessionId: 7,
    };
    const profiles = [
      {
        command: null,
        id: "default",
        label: "Default Shell",
      },
    ];
    const output: TerminalOutputEvent = { data: "ready", sessionId: 7 };
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "list_terminal_profiles") {
        return profiles;
      }

      if (
        command === "write_terminal_input" ||
        command === "resize_terminal_session"
      ) {
        return undefined;
      }

      return running;
    });
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({ payload: output });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriTerminalGateway(
      invokeCommand,
      listenToEvent,
      () => true,
    );

    await expect(gateway.listProfiles()).resolves.toEqual(profiles);
    await expect(
      gateway.start("/workspace", { cols: 80, rows: 24 }, "default"),
    ).resolves.toEqual(running);
    await expect(gateway.writeInput(7, "pwd\r")).resolves.toBeUndefined();
    await expect(
      gateway.resize(7, { cols: 120, rows: 40 }),
    ).resolves.toBeUndefined();
    await expect(gateway.stop(7)).resolves.toEqual(running);
    await gateway.subscribeOutput(listener);

    expect(invokeCommand).toHaveBeenCalledWith("list_terminal_profiles");
    expect(invokeCommand).toHaveBeenCalledWith("start_terminal_session", {
      profileId: "default",
      rootPath: "/workspace",
      size: { cols: 80, rows: 24 },
    });
    expect(invokeCommand).toHaveBeenCalledWith("write_terminal_input", {
      data: "pwd\r",
      sessionId: 7,
    });
    expect(invokeCommand).toHaveBeenCalledWith("resize_terminal_session", {
      sessionId: 7,
      size: { cols: 120, rows: 40 },
    });
    expect(invokeCommand).toHaveBeenCalledWith("stop_terminal_session", {
      sessionId: 7,
    });
    expect(listenToEvent).toHaveBeenCalledWith(
      "terminal://output",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(output);
  });
});
