// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor } from "../domain/remoteRunner";
import {
  useRemoteRunnerCapability,
  type RemoteRunnerCapability,
  type RemoteRunnerCapabilityState,
  type RemoteRunnerCapabilityTarget,
} from "./useRemoteRunnerCapability";

type Pending = { serverId: string; resolve(value: RemoteRunnerDescriptor): void };

function descriptor(runnerId: string, portPreview: boolean): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId,
    name: "runner",
    capabilities: { taskExecution: true, eventReplay: true, portPreview },
  };
}

describe("useRemoteRunnerCapability", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: RemoteRunnerCapabilityState;
  let capability: RemoteRunnerCapability;
  let pending: Pending[];
  const gateway = {
    getRunner: vi.fn(
      ({ serverId }: { serverId: string }) =>
        new Promise<RemoteRunnerDescriptor>((resolve) => pending.push({ serverId, resolve })),
    ),
  };

  function Probe(props: { target: RemoteRunnerCapabilityTarget | null; connected: boolean }) {
    capability = useRemoteRunnerCapability(gateway, props.target, props.connected, "portPreview");
    state = capability.state;
    return null;
  }

  function render(target: RemoteRunnerCapabilityTarget | null, connected = true): void {
    act(() => root.render(<Probe connected={connected} target={target} />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    pending = [];
    gateway.getRunner.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("is idle while disconnected and reports the flag of the connected runner", async () => {
    render({ serverId: "a", runnerId: "runner-a" }, false);
    expect(state).toBe("idle");
    expect(gateway.getRunner).not.toHaveBeenCalled();

    render({ serverId: "a", runnerId: "runner-a" });
    expect(state).toBe("checking");
    await act(async () => pending[0]?.resolve(descriptor("runner-a", true)));
    expect(state).toBe("supported");
  });

  it("asks once per runner even when the gateway object changes on every render", async () => {
    function Unstable({ tick }: { tick: number }) {
      const unstable = { getRunner: gateway.getRunner };
      state = useRemoteRunnerCapability(
        unstable,
        { serverId: "a", runnerId: "runner-a" },
        tick >= 0,
        "portPreview",
      ).state;
      return null;
    }
    for (let tick = 0; tick < 5; tick += 1) act(() => root.render(<Unstable tick={tick} />));
    await act(async () => pending[0]?.resolve(descriptor("runner-a", true)));
    act(() => root.render(<Unstable tick={9} />));

    expect(gateway.getRunner).toHaveBeenCalledTimes(1);
    expect(state).toBe("supported");
  });

  it("fails closed when the runner identity changed", async () => {
    render({ serverId: "a", runnerId: "runner-a" });
    await act(async () => pending[0]?.resolve(descriptor("runner-b", true)));
    expect(state).toBe("failed");
  });

  it("checks again on demand only after a failed check", async () => {
    render({ serverId: "a", runnerId: "runner-a" });
    act(() => capability.recheck());
    expect(gateway.getRunner).toHaveBeenCalledTimes(1);
    await act(async () => pending[0]?.resolve(descriptor("runner-b", true)));
    expect(state).toBe("failed");

    act(() => capability.recheck());
    expect(state).toBe("checking");
    await act(async () => pending[1]?.resolve(descriptor("runner-a", true)));
    expect(gateway.getRunner).toHaveBeenCalledTimes(2);
    expect(state).toBe("supported");
  });

  it("drops a late answer for a server that is no longer selected", async () => {
    render({ serverId: "a", runnerId: "runner-a" });
    render({ serverId: "b", runnerId: "runner-b" });
    await act(async () => pending[0]?.resolve(descriptor("runner-a", true)));
    expect(state).toBe("checking");
    await act(async () => pending[1]?.resolve(descriptor("runner-b", false)));
    expect(state).toBe("unsupported");

    render({ serverId: "a", runnerId: "runner-a" });
    expect(state).toBe("checking");
    expect(gateway.getRunner).toHaveBeenCalledTimes(3);
  });
});
