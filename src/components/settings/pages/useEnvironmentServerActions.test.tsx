// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../../../domain/remoteRunner";
import {
  useEnvironmentServerActions,
  type EnvironmentServerActions,
  type EnvironmentServerActionsSurface,
} from "./useEnvironmentServerActions";

const server: RemoteRunnerServer = {
  id: "server-1",
  name: "Linux",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: false,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function surface(gateway: RemoteRunnerGateway): EnvironmentServerActionsSurface {
  return {
    gateway,
    connect: vi.fn<EnvironmentServerActionsSurface["connect"]>(),
    disconnect: vi.fn<EnvironmentServerActionsSurface["disconnect"]>().mockResolvedValue(),
    remove: vi.fn<EnvironmentServerActionsSurface["remove"]>().mockResolvedValue(),
  };
}

const cleanup: (() => void)[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

function render(initial: EnvironmentServerActionsSurface) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  let actions: EnvironmentServerActions | null = null;
  function Harness({ remote }: { readonly remote: EnvironmentServerActionsSurface }) {
    actions = useEnvironmentServerActions(remote);
    return null;
  }
  act(() => root.render(<Harness remote={initial} />));
  cleanup.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const current = (): EnvironmentServerActions => {
    expect(actions).not.toBeNull();
    return actions as unknown as EnvironmentServerActions;
  };
  return {
    current,
    replace: (remote: EnvironmentServerActionsSurface) =>
      act(() => root.render(<Harness remote={remote} />)),
  };
}

describe("useEnvironmentServerActions", () => {
  it("drops a connecting attempt and its late failure after A to B to A", async () => {
    const gatewayA = {} as RemoteRunnerGateway;
    const gatewayB = {} as RemoteRunnerGateway;
    const remoteA = surface(gatewayA);
    const pending = deferred<RemoteRunnerServer | null>();
    vi.mocked(remoteA.connect).mockReturnValue(pending.promise);
    const view = render(remoteA);

    act(() => view.current().connect(server));
    expect(view.current().phaseOf(server.id)).toBe("connecting");

    view.replace(surface(gatewayB));
    expect(view.current().phaseOf(server.id)).toBe("idle");

    view.replace(surface(gatewayA));
    expect(view.current().phaseOf(server.id)).toBe("idle");

    await act(async () => pending.resolve(null));
    expect(view.current().phaseOf(server.id)).toBe("idle");
  });

  it("records a failure only for the current owner and attempt", async () => {
    const remote = surface({} as RemoteRunnerGateway);
    vi.mocked(remote.connect).mockResolvedValue(null);
    const view = render(remote);

    await act(async () => view.current().connect(server));
    expect(view.current().phaseOf(server.id)).toBe("failed");
    expect(view.current().phaseOf("other")).toBe("idle");

    act(() => view.current().disconnect(server.id));
    expect(view.current().phaseOf(server.id)).toBe("idle");
    expect(remote.disconnect).toHaveBeenCalledWith(server.id);
  });

  it("ignores a superseded connect settlement", async () => {
    const remote = surface({} as RemoteRunnerGateway);
    const pending = deferred<RemoteRunnerServer | null>();
    vi.mocked(remote.connect).mockReturnValue(pending.promise);
    const view = render(remote);

    act(() => view.current().connect(server));
    act(() => view.current().resetAttempt());
    await act(async () => pending.resolve(null));
    expect(view.current().phaseOf(server.id)).toBe("idle");
  });
});
