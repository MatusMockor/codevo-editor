// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../domain/remoteRunnerReachability";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { RemoteGitSyncPort, RemoteThreadGitStatus } from "../domain/remoteGitSync";
import type { RemoteProjectKind } from "../domain/remoteProjectKind";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import type { RemoteRunnerServer } from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import { RemoteRepositoryIdentityCoordinator } from "./remoteRepositoryIdentityCoordinator";
import { REPOSITORY_IDENTITY_RETRY_DELAYS_MS } from "./repositoryIdentityRetry";
import {
  deferred,
  manualIdentityTimers,
  recordingRemoteIdentityGateway,
} from "../test/repositoryIdentityTestSupport";
import { useProjectRepositoryIdentities } from "./useProjectRepositoryIdentities";
import { useRemoteAgentShip, type RemoteAgentShip } from "./useRemoteAgentShip";
import {
  REMOTE_SHIP_IDENTITY_UNREAD_MESSAGE,
  REMOTE_SHIP_IDENTITY_WAIT_MS,
} from "./useRemoteShipIdentities";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[] }>>>;
}>;
const status = (wireContract as unknown as Contract).sections.threadGitStatus!.accepted.find(
  (entry) => entry.name === "worktreeFromOrigin",
)!.value as RemoteThreadGitStatus;

const SERVER = "linux";
const RUNNER = "runner";
const REPOSITORY = "github.com/acme/app";
const server: RemoteRunnerServer = {
  id: SERVER,
  name: "Linux",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: true,
};
const PROJECT_IDS = ["app", ...Array.from({ length: 8 }, (_, index) => `project${index}`)];
const snapshot = {
  ...emptyRemoteInventory(SERVER, true),
  descriptor: {
    protocolVersion: 1 as const,
    runnerId: RUNNER,
    name: "Linux",
    capabilities: { taskExecution: true, eventReplay: true, gitSync: true },
  },
  projects: PROJECT_IDS.map((id) => ({ id, name: id })),
};
const threadIdOf = (projectId: string) => remoteAgentThreadKey(SERVER, RUNNER, `${projectId}-task`);
const viewOf = (projectId: string): AgentThreadView =>
  ({
    thread: { threadId: threadIdOf(projectId) },
    lifecycle: "idle",
    ship: { kind: "idle", status: null, loadingStatus: false },
    execution: {
      kind: "remote",
      serverId: SERVER,
      runnerId: RUNNER,
      projectId,
      conversationId: `${projectId}-task`,
      latestTaskId: `${projectId}-task`,
      resume: null,
      reachability: REMOTE_RUNNER_REACHABLE,
    },
  }) as unknown as AgentThreadView;
const views = new Map(PROJECT_IDS.map((id) => [threadIdOf(id), viewOf(id)]));
const remoteProjects = PROJECT_IDS.slice(1).map((id) => {
  const rootKey = remoteAgentProjectKey(SERVER, RUNNER, id);
  return projectFixture({ rootKey, rootPath: rootKey, ownerId: rootKey });
});

function gitPort() {
  return {
    branches: vi.fn(),
    projectStatus: vi.fn(),
    fetch: vi.fn(),
    update: vi.fn(),
    threadStatus: vi.fn().mockResolvedValue(status),
    commit: vi.fn(),
    push: vi.fn(),
    pollOperation: vi.fn(),
    awaitOperation: vi.fn(),
  } satisfies RemoteGitSyncPort;
}

interface HarnessProps {
  readonly identity: RemoteRepositoryIdentityGateway | null;
  readonly selectedThreadId: string | null;
  readonly snapshots?: readonly RemoteAgentInventorySnapshot[];
  readonly servers?: readonly RemoteRunnerServer[];
  readonly discover?: boolean;
  readonly strict?: boolean;
}

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

function mount(initial: HarnessProps, retries = manualIdentityTimers()) {
  const root = createRoot(document.createElement("div"));
  const port = gitPort();
  const report = vi.fn();
  const reportError = vi.fn();
  const servers = [server];
  const snapshots = [snapshot];
  let ship!: RemoteAgentShip;
  let identities: ReadonlyMap<string, string> = new Map();
  function Harness(props: HarnessProps) {
    ship = useRemoteAgentShip({
      port,
      identity: props.identity,
      identityTimers: retries.timers,
      externalUrlOpener: null,
      snapshots: props.snapshots ?? snapshots,
      servers: props.servers ?? servers,
      views,
      selectedThreadId: props.selectedThreadId,
      report,
      reportError,
    });
    identities = useProjectRepositoryIdentities(
      props.discover === true ? remoteProjects : [],
      null,
      props.identity,
      retries.timers,
    );
    return null;
  }
  const element = (props: HarnessProps) =>
    props.strict === true
      ? createElement(StrictMode, null, createElement(Harness, props))
      : createElement(Harness, props);
  const render = (props: HarnessProps) => act(() => root.render(element(props)));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  disposers.push(unmount);
  render(initial);
  return {
    port,
    retries,
    report,
    reportError,
    render,
    unmount,
    ship: () => ship,
    identities: () => identities,
  };
}

async function settle() {
  await act(async () => {
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
  });
}

const APP_THREAD = threadIdOf("app");
const shipOf = (h: ReturnType<typeof mount>) =>
  JSON.stringify(h.ship().present(views.get(APP_THREAD)!).ship);

describe("remote agent ship repository identity", () => {
  it("is available without a compare key after the first failure and gains it on a retry", async () => {
    const runner = recordingRemoteIdentityGateway((_, call) =>
      call === 1 ? Promise.reject(new Error("HTTP 503 busy")) : Promise.resolve(REPOSITORY),
    );
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.ship().present(views.get(APP_THREAD)!).execution?.gitShip).toBe(true);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(shipOf(h)).not.toContain(REPOSITORY);
    expect(h.retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);

    act(() => h.retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]!));
    await settle();
    expect(runner.requests).toHaveLength(2);
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(shipOf(h)).toContain(REPOSITORY);
    expect(h.retries.pendingCount()).toBe(0);
    expect(h.report).not.toHaveBeenCalled();
  });

  it("becomes available after a bounded wait while the first lookup is still pending", async () => {
    const pending = deferred<string | null>();
    const runner = recordingRemoteIdentityGateway(() => pending.promise);
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    expect(h.ship().present(views.get(APP_THREAD)!)).toBe(views.get(APP_THREAD));
    expect(h.retries.pendingDelays()).toEqual([REMOTE_SHIP_IDENTITY_WAIT_MS]);
    act(() => h.retries.advance(REMOTE_SHIP_IDENTITY_WAIT_MS - 1));
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    act(() => h.retries.advance(1));
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(shipOf(h)).not.toContain(REPOSITORY);

    await act(async () => {
      pending.resolve(REPOSITORY);
    });
    await settle();
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(shipOf(h)).toContain(REPOSITORY);
    expect(runner.requests).toHaveLength(1);
    expect(h.retries.pendingCount()).toBe(0);
    expect(h.report).not.toHaveBeenCalled();
  });

  it("cancels the bounded wait when the selection changes during the first lookup", async () => {
    const pending = deferred<string | null>();
    const runner = recordingRemoteIdentityGateway(() => pending.promise);
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.retries.pendingDelays()).toEqual([REMOTE_SHIP_IDENTITY_WAIT_MS]);
    h.render({ identity: runner.gateway, selectedThreadId: null });
    expect(h.retries.pendingCount()).toBe(0);
    act(() => h.retries.advance(REMOTE_SHIP_IDENTITY_WAIT_MS));
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    await act(async () => {
      pending.resolve(REPOSITORY);
    });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    expect(h.report).not.toHaveBeenCalled();
  });

  it("settles a repository without an origin as a missing key without retrying", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(null));
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.retries.scheduled).toEqual([REMOTE_SHIP_IDENTITY_WAIT_MS]);
    expect(h.retries.pendingCount()).toBe(0);
    expect(h.report).not.toHaveBeenCalled();
    expect(runner.requests).toHaveLength(1);
    act(() => h.retries.advance(600_000));
    await settle();
    expect(runner.requests).toHaveLength(1);
  });

  it("reports an exhausted lookup once and recovers when the thread is selected again", async () => {
    const attemptsPerSelection = REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 1;
    const runner = recordingRemoteIdentityGateway((_, call) =>
      call <= 2 * attemptsPerSelection
        ? Promise.reject(new Error("offline at ssh://10.0.0.5"))
        : Promise.resolve(REPOSITORY),
    );
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    const exhaust = async () => {
      await settle();
      for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
        expect(h.ship().supports(APP_THREAD)).toBe(true);
        act(() => h.retries.advance(60_000));
        await settle();
      }
    };
    await exhaust();
    expect(runner.requests).toHaveLength(attemptsPerSelection);
    expect(h.retries.pendingCount()).toBe(0);
    expect(h.report.mock.calls).toEqual([[REMOTE_SHIP_IDENTITY_UNREAD_MESSAGE]]);
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(h.port.threadStatus).toHaveBeenCalledTimes(1);
    expect(shipOf(h)).not.toContain("acme");
    act(() => h.retries.advance(600_000));
    await settle();
    expect(runner.requests).toHaveLength(attemptsPerSelection);

    h.render({ identity: runner.gateway, selectedThreadId: null });
    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await exhaust();
    expect(runner.requests).toHaveLength(2 * attemptsPerSelection);
    expect(h.report).toHaveBeenCalledTimes(1);

    h.render({ identity: runner.gateway, selectedThreadId: null });
    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(runner.requests).toHaveLength(2 * attemptsPerSelection + 1);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(shipOf(h)).toContain(REPOSITORY);
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(h.retries.pendingCount()).toBe(0);
  });

  it("issues one runner request under StrictMode and settles", async () => {
    const hold = deferred<string | null>();
    const runner = recordingRemoteIdentityGateway(() => hold.promise);
    const retries = manualIdentityTimers();
    const coordinator = new RemoteRepositoryIdentityCoordinator(runner.gateway, retries.timers);
    const h = mount({ identity: coordinator, selectedThreadId: APP_THREAD, strict: true }, retries);
    await settle();
    expect(runner.requests).toHaveLength(1);
    await act(async () => {
      hold.resolve(REPOSITORY);
    });
    await settle();
    expect(runner.requests).toHaveLength(1);
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.retries.pendingCount()).toBe(0);
  });

  it("cancels a pending retry when the selection changes or the hook unmounts", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.reject(new Error("offline")));
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.retries.pendingCount()).toBe(1);
    h.render({ identity: runner.gateway, selectedThreadId: null });
    expect(h.retries.pendingCount()).toBe(0);
    h.render({ identity: runner.gateway, selectedThreadId: threadIdOf("project0") });
    await settle();
    expect(h.retries.pendingCount()).toBe(1);
    expect(runner.requests.map((request) => request.projectId)).toEqual(["app", "project0"]);
    h.unmount();
    expect(h.retries.pendingCount()).toBe(0);
    await settle();
    expect(runner.requests).toHaveLength(2);
  });

  it("schedules no retry and reports nothing when a read fails after unmount", async () => {
    const pending = deferred<string | null>();
    const runner = recordingRemoteIdentityGateway(() => pending.promise);
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    h.unmount();
    pending.reject(new Error("offline"));
    await settle();
    expect(h.retries.scheduled).toEqual([REMOTE_SHIP_IDENTITY_WAIT_MS]);
    expect(h.retries.pendingCount()).toBe(0);
    expect(h.report).not.toHaveBeenCalled();
    expect(runner.requests).toHaveLength(1);
  });

  it("clears its retry timer with the default scheduler on unmount", async () => {
    vi.useFakeTimers();
    const runner = recordingRemoteIdentityGateway(() => Promise.reject(new Error("offline")));
    const root = createRoot(document.createElement("div"));
    const port = gitPort();
    const servers = [server];
    const snapshots = [snapshot];
    const report = vi.fn();
    function Harness() {
      useRemoteAgentShip({
        port,
        identity: runner.gateway,
        externalUrlOpener: null,
        snapshots,
        servers,
        views,
        selectedThreadId: APP_THREAD,
        report,
        reportError: report,
      });
      return null;
    }
    act(() => root.render(createElement(Harness)));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(runner.requests).toHaveLength(1);
  });

  it("ignores a late result from a replaced identity gateway", async () => {
    const stale = deferred<string | null>();
    const before = recordingRemoteIdentityGateway(() => stale.promise);
    const after = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const h = mount({ identity: before.gateway, selectedThreadId: APP_THREAD });
    await settle();
    h.render({ identity: after.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await act(async () => {
      stale.resolve("github.com/acme/stale");
    });
    await settle();
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    const presented = JSON.stringify(h.ship().present(views.get(APP_THREAD)!).ship);
    expect(presented).toContain(REPOSITORY);
    expect(presented).not.toContain("github.com/acme/stale");
  });

  it("never exceeds two concurrent runner lookups across discovery and ship", async () => {
    const holds: ReturnType<typeof deferred<string | null>>[] = [];
    const runner = recordingRemoteIdentityGateway(() => {
      const hold = deferred<string | null>();
      holds.push(hold);
      return hold.promise;
    });
    const retries = manualIdentityTimers();
    const coordinator = new RemoteRepositoryIdentityCoordinator(runner.gateway, retries.timers);
    const h = mount(
      { identity: coordinator, selectedThreadId: APP_THREAD, discover: true },
      retries,
    );
    await settle();
    expect(runner.active(SERVER)).toBe(2);
    for (let round = 0; round < PROJECT_IDS.length; round += 1) {
      expect(runner.active(SERVER)).toBeLessThanOrEqual(2);
      await act(async () => {
        holds.splice(0).forEach((hold) => hold.resolve(REPOSITORY));
      });
      await settle();
    }
    expect(runner.maximumPerServer()).toBe(2);
    expect(runner.requests).toHaveLength(PROJECT_IDS.length);
    expect(h.identities().size).toBe(remoteProjects.length);
    expect(h.ship().supports(APP_THREAD)).toBe(true);
  });

  it("shares one runner request when discovery and ship ask for the same project", async () => {
    const hold = deferred<string | null>();
    const runner = recordingRemoteIdentityGateway(() => hold.promise);
    const retries = manualIdentityTimers();
    const coordinator = new RemoteRepositoryIdentityCoordinator(runner.gateway, retries.timers);
    const h = mount(
      { identity: coordinator, selectedThreadId: threadIdOf("project0"), discover: true },
      retries,
    );
    await settle();
    expect(runner.requests.filter((request) => request.projectId === "project0")).toHaveLength(1);
    await act(async () => {
      hold.resolve(REPOSITORY);
    });
    await settle();
    expect(runner.requests.filter((request) => request.projectId === "project0")).toHaveLength(1);
    expect(h.ship().supports(threadIdOf("project0"))).toBe(true);
    expect(h.identities().get(remoteAgentProjectKey(SERVER, RUNNER, "project0"))).toBe(REPOSITORY);
  });
});

describe("remote agent ship in a folder project", () => {
  const APP_KEY = remoteAgentProjectKey(SERVER, RUNNER, "app");
  const SIBLING = "project0";
  const SIBLING_THREAD = threadIdOf(SIBLING);
  const SIBLING_KEY = remoteAgentProjectKey(SERVER, RUNNER, SIBLING);
  const withKinds = (
    kinds: Readonly<Record<string, RemoteProjectKind>>,
    base: RemoteAgentInventorySnapshot = snapshot,
  ): readonly RemoteAgentInventorySnapshot[] => [
    {
      ...base,
      projects: PROJECT_IDS.map((id) => {
        const kind = kinds[id];
        return kind === undefined ? { id, name: id } : { id, name: id, kind };
      }),
    },
  ];
  const APP_FOLDER = withKinds({ app: "folder" });
  const APP_REPOSITORY = withKinds({ app: "repository" });
  const ALL_FOLDERS = withKinds(
    Object.fromEntries(PROJECT_IDS.map((id) => [id, "folder" as const])),
  );
  const appView = views.get(APP_THREAD)!;

  it("asks the runner nothing and leaves the thread unshippable", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const h = mount({
      identity: runner.gateway,
      selectedThreadId: APP_THREAD,
      snapshots: APP_FOLDER,
    });
    await settle();
    act(() => h.retries.advance(REMOTE_SHIP_IDENTITY_WAIT_MS));
    await settle();
    expect(runner.requests).toEqual([]);
    expect(h.retries.scheduled).toEqual([]);
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    expect(h.ship().present(appView)).toBe(appView);
    expect(h.ship().present(appView).execution?.gitShip).toBeUndefined();
    expect(h.ship().access?.project(APP_KEY)).toBeNull();
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    let committed: Awaited<ReturnType<RemoteAgentShip["ship"]["commit"]>> | undefined;
    let pushed: Awaited<ReturnType<RemoteAgentShip["ship"]["push"]>> | undefined;
    await act(async () => {
      committed = await h.ship().ship.commit(APP_THREAD, "message");
      pushed = await h.ship().ship.push(APP_THREAD);
    });
    expect(committed?.kind).toBe("notRun");
    expect(pushed?.kind).toBe("notRun");
    expect(h.port.threadStatus).not.toHaveBeenCalled();
    expect(h.port.commit).not.toHaveBeenCalled();
    expect(h.port.push).not.toHaveBeenCalled();
    expect(h.ship().ship.states.size).toBe(0);
    expect(h.report).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it("keeps a repository project on the same runner shippable", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const h = mount({
      identity: runner.gateway,
      selectedThreadId: SIBLING_THREAD,
      snapshots: APP_FOLDER,
    });
    await settle();
    expect(runner.requests.map((request) => request.projectId)).toEqual([SIBLING]);
    expect(h.ship().supports(SIBLING_THREAD)).toBe(true);
    expect(h.ship().present(views.get(SIBLING_THREAD)!).execution?.gitShip).toBe(true);
    expect(h.ship().access?.project(SIBLING_KEY)).toEqual({
      serverId: SERVER,
      runnerId: RUNNER,
      projectId: SIBLING,
    });
    expect(h.ship().access?.project(APP_KEY)).toBeNull();
    await act(async () => h.ship().ship.refreshShipStatus(SIBLING_THREAD));
    expect(h.port.threadStatus).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit repository kind exactly like a runner that reports no kind", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    const access = h.ship().access;
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD, snapshots: APP_REPOSITORY });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.ship().access?.project(APP_KEY)).toEqual(access?.project(APP_KEY));
    expect(runner.requests).toHaveLength(1);
  });

  it("offers no Git access at all on a runner that has only folder projects", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const h = mount({
      identity: runner.gateway,
      selectedThreadId: APP_THREAD,
      snapshots: ALL_FOLDERS,
    });
    await settle();
    expect(h.ship().access).toBeUndefined();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    expect(h.ship().supports(SIBLING_THREAD)).toBe(false);
    expect(runner.requests).toEqual([]);
  });

  it("invalidates the project map and drops a late status when the kind changes", async () => {
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const late = deferred<RemoteThreadGitStatus>();
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    const repositoryAccess = h.ship().access;
    expect(repositoryAccess?.project(APP_KEY)).not.toBeNull();
    h.port.threadStatus.mockReturnValueOnce(late.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = h.ship().ship.refreshShipStatus(APP_THREAD);
    });
    expect(h.port.threadStatus).toHaveBeenCalledTimes(1);

    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD, snapshots: APP_FOLDER });
    expect(h.ship().access).not.toBe(repositoryAccess);
    expect(h.ship().access?.project(APP_KEY)).toBeNull();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    await act(async () => {
      late.resolve(status);
      await refresh;
    });
    await settle();
    expect(h.ship().ship.gitStatuses.has(APP_THREAD)).toBe(false);
    expect(h.ship().present(appView)).toBe(appView);
    expect(h.reportError).not.toHaveBeenCalled();
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(h.port.threadStatus).toHaveBeenCalledTimes(1);

    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD });
    await settle();
    expect(h.ship().access?.project(APP_KEY)).toEqual(repositoryAccess?.project(APP_KEY));
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
    expect(h.port.threadStatus).toHaveBeenCalledTimes(2);
    expect(h.ship().ship.gitStatuses.has(APP_THREAD)).toBe(true);
  });

  it.each(["folder", "repository"] as const)(
    "sends nothing for a retained thread once its %s project is omitted from the inventory",
    async (kind) => {
      const omitted: readonly RemoteAgentInventorySnapshot[] = [
        {
          ...snapshot,
          projects: PROJECT_IDS.filter((id) => id !== "app").map((id) => ({ id, name: id })),
        },
      ];
      const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
      const h = mount({
        identity: runner.gateway,
        selectedThreadId: APP_THREAD,
        snapshots: withKinds({ app: kind }),
      });
      await settle();
      const listedRequests = runner.requests.length;
      expect(h.ship().supports(APP_THREAD)).toBe(kind === "repository");

      h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD, snapshots: omitted });
      await settle();
      act(() => h.retries.advance(REMOTE_SHIP_IDENTITY_WAIT_MS));
      await settle();
      expect(runner.requests).toHaveLength(listedRequests);
      expect(h.ship().supports(APP_THREAD)).toBe(false);
      expect(h.ship().present(appView)).toBe(appView);
      expect(h.ship().present(appView).execution?.gitShip).toBeUndefined();
      expect(h.ship().access?.project(APP_KEY)).toBeNull();
      await act(async () => h.ship().ship.refreshShipStatus(APP_THREAD));
      let committed: Awaited<ReturnType<RemoteAgentShip["ship"]["commit"]>> | undefined;
      let pushed: Awaited<ReturnType<RemoteAgentShip["ship"]["push"]>> | undefined;
      await act(async () => {
        committed = await h.ship().ship.commit(APP_THREAD, "message");
        pushed = await h.ship().ship.push(APP_THREAD);
      });
      expect(committed?.kind).toBe("notRun");
      expect(pushed?.kind).toBe("notRun");
      expect(h.port.threadStatus).not.toHaveBeenCalled();
      expect(h.port.commit).not.toHaveBeenCalled();
      expect(h.port.push).not.toHaveBeenCalled();
      expect(h.reportError).not.toHaveBeenCalled();

      expect(h.ship().access?.project(SIBLING_KEY)).not.toBeNull();
      h.render({ identity: runner.gateway, selectedThreadId: SIBLING_THREAD, snapshots: omitted });
      await settle();
      expect(runner.requests.slice(listedRequests).map((request) => request.projectId)).toEqual([
        SIBLING,
      ]);
      expect(h.ship().supports(SIBLING_THREAD)).toBe(true);
      await act(async () => h.ship().ship.refreshShipStatus(SIBLING_THREAD));
      expect(h.port.threadStatus).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the folder kind of one server away from the same project id on another", async () => {
    const OTHER = "other";
    const otherServer: RemoteRunnerServer = { ...server, id: OTHER, name: "Other" };
    const otherFolder = withKinds({ app: "folder" }, { ...snapshot, serverId: OTHER });
    const OTHER_APP_KEY = remoteAgentProjectKey(OTHER, RUNNER, "app");
    const runner = recordingRemoteIdentityGateway(() => Promise.resolve(REPOSITORY));
    const both = { snapshots: [snapshot, ...otherFolder], servers: [server, otherServer] };
    const h = mount({ identity: runner.gateway, selectedThreadId: APP_THREAD, ...both });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.ship().access?.project(APP_KEY)).not.toBeNull();
    expect(h.ship().access?.project(OTHER_APP_KEY)).toBeNull();
    expect(runner.requests.map((request) => request.serverId)).toEqual([SERVER]);

    h.render({
      identity: runner.gateway,
      selectedThreadId: APP_THREAD,
      snapshots: otherFolder,
      servers: [otherServer],
    });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(false);
    expect(h.ship().access?.project(APP_KEY)).toBeNull();
    expect(h.ship().access?.project(OTHER_APP_KEY)).toBeNull();

    h.render({ identity: runner.gateway, selectedThreadId: APP_THREAD, ...both });
    await settle();
    expect(h.ship().supports(APP_THREAD)).toBe(true);
    expect(h.ship().access?.project(APP_KEY)).not.toBeNull();
    expect(h.ship().access?.project(OTHER_APP_KEY)).toBeNull();
    expect(runner.requests.every((request) => request.serverId === SERVER)).toBe(true);
  });
});
