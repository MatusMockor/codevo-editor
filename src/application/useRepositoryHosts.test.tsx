// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor, RemoteRunnerGateway } from "../domain/remoteRunner";
import type {
  RepositoryHostsSnapshot,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import { repositoryHostsAvailability, useRepositoryHosts } from "./useRepositoryHosts";

const readySnapshot: RepositoryHostsSnapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: {
    status: "ready",
    hosts: [
      { provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" },
      { provider: "gitlab", host: "gitlab.com", auth: "notAuthenticated" },
    ],
    truncated: false,
  },
};

const descriptor: RemoteRunnerDescriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
};

class FakeLookupGateway implements RepositoryLookupGateway {
  calls = 0;
  constructor(
    private readonly snapshot: RepositoryHostsSnapshot | Error,
    private readonly gate?: Promise<void>,
  ) {}
  async listHosts(): Promise<RepositoryHostsSnapshot> {
    this.calls += 1;
    await this.gate;
    if (this.snapshot instanceof Error) throw this.snapshot;
    return this.snapshot;
  }
  async lookup(_request: RepositoryLookupRequest): Promise<RepositoryLookupOutcome> {
    return { status: "notFound" };
  }
}

let dispose: () => void = () => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  dispose();
});

function setup(options: {
  lookupGateway: RepositoryLookupGateway | null;
  getRunner?: RemoteRunnerGateway["getRunner"];
}) {
  const getRunner = vi.fn(options.getRunner ?? (async () => descriptor));
  const runnerGateway = { getRunner } as unknown as RemoteRunnerGateway;
  const root = createRoot(document.createElement("div"));
  let result!: ReturnType<typeof useRepositoryHosts>;
  function Harness({
    open,
    server,
    connected,
  }: {
    open: boolean;
    server: string | null;
    connected: boolean;
  }) {
    result = useRepositoryHosts({
      runnerGateway: connected ? runnerGateway : null,
      lookupGateway: options.lookupGateway,
      serverId: server,
      workspaceOwner: "workspace",
      open,
    });
    return null;
  }
  const render = (open: boolean, server: string | null = "server-a", connected = true) =>
    act(() => root.render(<Harness open={open} server={server} connected={connected} />));
  render(false);
  dispose = () => {
    dispose = () => undefined;
    act(() => root.unmount());
  };
  return {
    getRunner,
    render,
    get result() {
      return result;
    },
  };
}

it("stays idle until the dialog opens and loads once per open", async () => {
  const gateway = new FakeLookupGateway(readySnapshot);
  const view = setup({ lookupGateway: gateway });
  expect(gateway.calls).toBe(0);
  expect(view.result.availability.github).toEqual({ status: "checking" });

  await act(async () => {
    view.render(true);
  });
  expect(gateway.calls).toBe(1);
  view.render(true);
  expect(gateway.calls).toBe(1);

  await act(async () => {
    view.render(false);
  });
  await act(async () => {
    view.render(true);
  });
  expect(gateway.calls).toBe(2);
});

it("exposes only authenticated hosts and reports both providers ready", async () => {
  const view = setup({ lookupGateway: new FakeLookupGateway(readySnapshot) });
  await act(async () => {
    view.render(true);
  });
  expect(view.result.hosts).toEqual({
    github: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    gitlab: [{ provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" }],
  });
  expect(view.result.availability).toEqual({
    serverProject: { status: "ready" },
    gitUrl: { status: "ready" },
    github: { status: "ready" },
    gitlab: { status: "ready" },
  });
});

it("reports a host load failure as hostsFailed", async () => {
  const view = setup({ lookupGateway: new FakeLookupGateway(new Error("ipc closed")) });
  await act(async () => {
    view.render(true);
  });
  expect(view.result.availability.github).toEqual({
    status: "unavailable",
    reason: "hostsFailed",
  });
  expect(view.result.availability.gitUrl).toEqual({ status: "ready" });
});

it("disables every clone source when the runner cannot clone", async () => {
  const view = setup({
    lookupGateway: new FakeLookupGateway(readySnapshot),
    getRunner: async () => ({
      ...descriptor,
      capabilities: { taskExecution: true, eventReplay: true },
    }),
  });
  await act(async () => {
    view.render(true);
  });
  const unsupported = { status: "unavailable", reason: "cloningUnsupported" };
  expect(view.result.availability).toEqual({
    serverProject: { status: "ready" },
    gitUrl: unsupported,
    github: unsupported,
    gitlab: unsupported,
  });
});

it("reports a failed capability probe as probeFailed and retries it", async () => {
  let failures = 1;
  const view = setup({
    lookupGateway: new FakeLookupGateway(readySnapshot),
    getRunner: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("offline");
      }
      return descriptor;
    },
  });
  await act(async () => {
    view.render(true);
  });
  expect(view.result.availability.gitUrl).toEqual({
    status: "unavailable",
    reason: "probeFailed",
  });
  expect(view.result.runnerId).toBeNull();
  await act(async () => {
    view.result.retry();
  });
  expect(view.getRunner).toHaveBeenCalledTimes(2);
  expect(view.result.availability.gitUrl).toEqual({ status: "ready" });
  expect(view.result.runnerId).toBe("runner");
});

it("reloads the hosts snapshot on retry", async () => {
  const gateway = new FakeLookupGateway(readySnapshot);
  const view = setup({ lookupGateway: gateway });
  await act(async () => {
    view.render(true);
  });
  expect(gateway.calls).toBe(1);
  await act(async () => {
    view.result.retry();
  });
  expect(gateway.calls).toBe(2);
});

it("exposes the truncated host flag per provider", async () => {
  const view = setup({
    lookupGateway: new FakeLookupGateway({
      github: {
        status: "ready",
        hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
        truncated: false,
      },
      gitlab: {
        status: "ready",
        hosts: [{ provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" }],
        truncated: true,
      },
    }),
  });
  await act(async () => {
    view.render(true);
  });
  expect(view.result.hostsTruncated).toEqual({ github: false, gitlab: true });
});

it("keeps git url usable when no lookup gateway exists", async () => {
  const view = setup({ lookupGateway: null });
  await act(async () => {
    view.render(true);
  });
  expect(view.result.availability.gitUrl).toEqual({ status: "ready" });
  expect(view.result.availability.github).toEqual({
    status: "unavailable",
    reason: "lookupUnavailable",
  });
  expect(view.result.hosts).toEqual({ github: [], gitlab: [] });
});

it("drops a snapshot that resolves after the owner changed", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const gateway = new FakeLookupGateway(readySnapshot, gate);
  const view = setup({ lookupGateway: gateway });
  view.render(true, "server-a");
  view.render(true, "server-b");
  await act(async () => {
    open();
    await gate;
  });
  expect(gateway.calls).toBe(2);
  expect(view.result.availability.github).toEqual({ status: "ready" });
});

it("refuses cloning without a selected server", async () => {
  const view = setup({ lookupGateway: new FakeLookupGateway(readySnapshot) });
  await act(async () => {
    view.render(true, null);
  });
  expect(view.getRunner).not.toHaveBeenCalled();
  expect(view.result.availability.gitUrl).toEqual({
    status: "unavailable",
    reason: "cloningUnsupported",
  });
});

it("refuses cloning while no runner gateway is connected", async () => {
  const view = setup({ lookupGateway: new FakeLookupGateway(readySnapshot) });
  await act(async () => {
    view.render(true, "server-a", false);
  });
  expect(view.getRunner).not.toHaveBeenCalled();
  const unsupported = { status: "unavailable", reason: "cloningUnsupported" };
  expect(view.result.availability).toEqual({
    serverProject: { status: "ready" },
    gitUrl: unsupported,
    github: unsupported,
    gitlab: unsupported,
  });
});

it("probes the capability again once a runner gateway appears", async () => {
  const view = setup({ lookupGateway: new FakeLookupGateway(readySnapshot) });
  await act(async () => {
    view.render(true, "server-a", false);
  });
  expect(view.result.availability.gitUrl).toEqual({
    status: "unavailable",
    reason: "cloningUnsupported",
  });
  await act(async () => {
    view.render(false, "server-a", false);
  });
  await act(async () => {
    view.render(true, "server-a", true);
  });
  expect(view.getRunner).toHaveBeenCalledTimes(1);
  expect(view.result.availability.gitUrl).toEqual({ status: "ready" });
});

it("maps every host state to a truthful availability", () => {
  const table = [
    { state: { status: "cliMissing" } as const, reason: "cliMissing" },
    { state: { status: "failed", reason: "timedOut" } as const, reason: "hostsFailed" },
    { state: { status: "failed", reason: "invalidOutput" } as const, reason: "hostsFailed" },
    { state: { status: "failed", reason: "busy" } as const, reason: "hostsFailed" },
    {
      state: { status: "ready", hosts: [], truncated: false } as const,
      reason: "notAuthenticated",
    },
    {
      state: {
        status: "ready",
        hosts: [{ provider: "github", host: "github.com", auth: "notAuthenticated" }],
        truncated: false,
      } as const,
      reason: "notAuthenticated",
    },
  ];

  for (const entry of table) {
    const availability = repositoryHostsAvailability({
      cloning: { status: "supported", runnerId: "runner" },
      lookupAvailable: true,
      load: { snapshot: { github: entry.state, gitlab: entry.state }, failed: false },
    });
    expect(availability.github).toEqual({ status: "unavailable", reason: entry.reason });
  }

  expect(
    repositoryHostsAvailability({
      cloning: { status: "supported", runnerId: "runner" },
      lookupAvailable: true,
      load: { snapshot: null, failed: false },
    }).gitlab,
  ).toEqual({ status: "checking" });
});
