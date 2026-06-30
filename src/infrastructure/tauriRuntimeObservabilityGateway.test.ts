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
});
