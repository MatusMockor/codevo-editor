// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type {
  RepositoryHostsSnapshot,
  RepositoryInfo,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";
import type { RemoteAddProjectLookupOutcome } from "./remoteAddProjectMachine";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import { useRepositoryLookup } from "./useRepositoryLookup";

const request: RepositoryLookupRequest = {
  provider: "github",
  host: "github.com",
  path: "acme/storefront-api",
};

const repository: RepositoryInfo = {
  provider: "github",
  host: "github.com",
  fullPath: "acme/storefront-api",
  description: null,
  visibility: "public",
  defaultBranch: "main",
  sshUrl: "git@github.com:acme/storefront-api.git",
  httpsUrl: "https://github.com/acme/storefront-api.git",
};

type Deferred = Readonly<{
  settle(outcome: RepositoryLookupOutcome): void;
  fail(reason: unknown): void;
}>;

class FakeLookupGateway implements RepositoryLookupGateway {
  readonly requests: RepositoryLookupRequest[] = [];
  private readonly queue: Deferred[] = [];

  async listHosts(): Promise<RepositoryHostsSnapshot> {
    return { github: { status: "cliMissing" }, gitlab: { status: "cliMissing" } };
  }

  lookup(next: RepositoryLookupRequest): Promise<RepositoryLookupOutcome> {
    this.requests.push(next);
    return new Promise<RepositoryLookupOutcome>((resolve, reject) => {
      this.queue.push({ settle: resolve, fail: reject });
    });
  }

  settle(index: number, outcome: RepositoryLookupOutcome): void {
    const deferred = this.queue[index];
    expect(deferred, `pending lookup ${index}`).toBeDefined();
    deferred?.settle(outcome);
  }

  fail(index: number, reason: unknown): void {
    const deferred = this.queue[index];
    expect(deferred, `pending lookup ${index}`).toBeDefined();
    deferred?.fail(reason);
  }
}

let dispose: () => void = () => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  dispose();
});

function setup() {
  const gateway = new FakeLookupGateway();
  const root = createRoot(document.createElement("div"));
  let result!: ReturnType<typeof useRepositoryLookup>;
  function Harness({
    server,
    port,
  }: {
    server: string | null;
    port: RepositoryLookupGateway | null;
  }) {
    result = useRepositoryLookup({ gateway: port, serverId: server, workspaceOwner: "workspace" });
    return null;
  }
  const render = (server: string | null, port: RepositoryLookupGateway | null = gateway) =>
    act(() => root.render(<Harness server={server} port={port} />));
  render("server-a");
  dispose = () => {
    dispose = () => undefined;
    act(() => root.unmount());
  };
  return {
    gateway,
    render,
    unmount: () => dispose(),
    get result() {
      return result;
    },
  };
}

it("publishes the outcome of the owning submission", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = null;
  await act(async () => {
    const pending = view.result.submit(request);
    view.gateway.settle(0, { status: "ok", repository });
    outcome = await pending;
  });
  expect(outcome).toEqual({ status: "ok", repository });
  expect(view.gateway.requests).toEqual([request]);
});

it("drops a reordered earlier result and keeps the latest submission", async () => {
  const view = setup();
  let first: RemoteAddProjectLookupOutcome | null = null;
  let second: RemoteAddProjectLookupOutcome | null = null;
  await act(async () => {
    const one = view.result.submit(request);
    const two = view.result.submit({ ...request, path: "acme/other" });
    view.gateway.settle(1, { status: "timedOut" });
    view.gateway.settle(0, { status: "notFound" });
    [first, second] = await Promise.all([one, two]);
  });
  expect(first).toBeNull();
  expect(second).toEqual({ status: "timedOut" });
});

it("settles a superseded outcome of the current generation as busy", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = null;
  await act(async () => {
    const pending = view.result.submit(request);
    view.gateway.settle(0, { status: "superseded" });
    outcome = await pending;
  });
  expect(outcome).toEqual({ status: "failed", reason: "busy" });
});

it("still drops a superseded outcome of a stale generation", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = { status: "notFound" };
  await act(async () => {
    const pending = view.result.submit(request);
    view.result.reset();
    view.gateway.settle(0, { status: "superseded" });
    outcome = await pending;
  });
  expect(outcome).toBeNull();
});

it("maps a gateway failure to a bounded failed outcome", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = null;
  await act(async () => {
    const pending = view.result.submit(request);
    view.gateway.fail(0, new TypeError("Invalid repository lookup value at outcome.status"));
    outcome = await pending;
  });
  expect(outcome).toEqual({ status: "failed", reason: "unknown" });
});

it("never claims a missing CLI when no lookup gateway exists", async () => {
  const view = setup();
  view.render("server-a", null);
  const outcome = await act(async () => view.result.submit(request));
  expect(outcome).toEqual({ status: "failed", reason: "unknown" });
  expect(view.gateway.requests).toEqual([]);
});

it("drops a late result across server A to B to A", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = { status: "notFound" };
  let pending!: Promise<RemoteAddProjectLookupOutcome | null>;
  act(() => {
    pending = view.result.submit(request);
  });
  view.render("server-b");
  view.render("server-a");
  await act(async () => {
    view.gateway.settle(0, { status: "ok", repository });
    outcome = await pending;
  });
  expect(outcome).toBeNull();
});

it("drops a result after reset", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = { status: "notFound" };
  await act(async () => {
    const pending = view.result.submit(request);
    view.result.reset();
    view.gateway.settle(0, { status: "notFound" });
    outcome = await pending;
  });
  expect(outcome).toBeNull();
});

it("drops a result that arrives after unmount", async () => {
  const view = setup();
  let outcome: RemoteAddProjectLookupOutcome | null = { status: "notFound" };
  let pending!: Promise<RemoteAddProjectLookupOutcome | null>;
  act(() => {
    pending = view.result.submit(request);
  });
  view.unmount();
  await act(async () => {
    view.gateway.settle(0, { status: "notFound" });
    outcome = await pending;
  });
  expect(outcome).toBeNull();
});
