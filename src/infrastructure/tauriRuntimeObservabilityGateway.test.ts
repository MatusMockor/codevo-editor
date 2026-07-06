import { describe, expect, it, vi } from "vitest";
import { TauriRuntimeObservabilityGateway } from "./tauriRuntimeObservabilityGateway";
import type { RuntimeObservabilityReport } from "../domain/runtimeObservability";

type GatewayConstructor = ConstructorParameters<
  typeof TauriRuntimeObservabilityGateway
>;
type InvokeCommand = NonNullable<GatewayConstructor[0]>;
type ListenToEvent = NonNullable<GatewayConstructor[1]>;

describe("TauriRuntimeObservabilityGateway", () => {
  it("stays quiet outside the Tauri desktop runtime", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriRuntimeObservabilityGateway(
      invokeCommand,
      listenToEvent,
      () => false,
    );

    await expect(gateway.getObservability("/workspace")).resolves.toEqual({
      rootPath: "/workspace",
      runtimes: [],
    });
    await expect(
      gateway.restart("/workspace", "phpactor"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.stop("/workspace", "tsserver"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.openLog("/workspace", "tsserver"),
    ).resolves.toBeNull();
    await expect(
      gateway.openLog("/workspace", "phpactor"),
    ).resolves.toBeNull();

    const unsubscribe = await gateway.subscribeStatus(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates observability, restart and stop to backend commands", async () => {
    const report: RuntimeObservabilityReport = {
      rootPath: "/workspace",
      runtimes: [
        {
          kind: "phpactor",
          label: "PHPactor",
          lifecycle: "running",
          pid: 4242,
          stats: { memoryKb: 81920, cpuPercent: 3.5 },
        },
        {
          kind: "tsserver",
          label: "TypeScript language server",
          lifecycle: "stopped",
        },
      ],
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => report);
    const gateway = new TauriRuntimeObservabilityGateway(
      invokeCommand,
      vi.fn(),
      () => true,
    );

    await expect(gateway.getObservability("/workspace")).resolves.toEqual(
      report,
    );
    await gateway.restart("/workspace", "phpactor");
    await gateway.stop("/workspace", "tsserver");

    expect(invokeCommand).toHaveBeenCalledWith("get_runtime_observability", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("restart_language_runtime", {
      rootPath: "/workspace",
      kind: "phpactor",
    });
    expect(invokeCommand).toHaveBeenCalledWith("stop_language_runtime", {
      rootPath: "/workspace",
      kind: "tsserver",
    });
  });

  it("opens runtime logs for both PHPactor and tsserver", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async (_command, args) => {
      const kind = String(args?.kind);

      return `/logs/${kind}.log`;
    });
    const gateway = new TauriRuntimeObservabilityGateway(
      invokeCommand,
      vi.fn(),
      () => true,
    );

    await expect(gateway.openLog("/workspace", "phpactor")).resolves.toBe(
      "/logs/phpactor.log",
    );
    await expect(gateway.openLog("/workspace", "tsserver")).resolves.toBe(
      "/logs/tsserver.log",
    );

    expect(invokeCommand).toHaveBeenCalledWith("open_language_runtime_log", {
      rootPath: "/workspace",
      kind: "phpactor",
    });
    expect(invokeCommand).toHaveBeenCalledWith("open_language_runtime_log", {
      rootPath: "/workspace",
      kind: "tsserver",
    });
  });

  it("drops observability reports that belong to a different root", async () => {
    const otherRootReport: RuntimeObservabilityReport = {
      rootPath: "/other",
      runtimes: [
        { kind: "phpactor", label: "PHPactor", lifecycle: "running", pid: 7 },
      ],
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => otherRootReport);
    const gateway = new TauriRuntimeObservabilityGateway(
      invokeCommand,
      vi.fn(),
      () => true,
    );

    await expect(gateway.getObservability("/workspace")).resolves.toEqual({
      rootPath: "/workspace",
      runtimes: [],
    });
  });

  it("subscribes to both language-server status events", async () => {
    const handlers: Array<() => void> = [];
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handlers.push(() => handler({ payload: undefined }));
      return () => undefined;
    });
    const gateway = new TauriRuntimeObservabilityGateway(
      vi.fn(),
      listenToEvent,
      () => true,
    );
    const listener = vi.fn();

    const unsubscribe = await gateway.subscribeStatus(listener);
    handlers.forEach((fire) => fire());

    expect(listenToEvent).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("keeps status unsubscribe idempotent when Tauri races listener cleanup", async () => {
    const unsubscribeCalls = vi.fn();
    const listenToEvent = vi.fn<ListenToEvent>(async () => () => {
      unsubscribeCalls();
      return Promise.reject(
        new TypeError(
          "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
        ),
      );
    });
    const gateway = new TauriRuntimeObservabilityGateway(
      vi.fn(),
      listenToEvent,
      () => true,
    );

    const unsubscribe = await gateway.subscribeStatus(vi.fn());

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unsubscribeCalls).toHaveBeenCalledTimes(2);
  });
});
