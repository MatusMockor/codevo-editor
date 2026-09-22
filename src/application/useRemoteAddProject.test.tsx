// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  RemoteRunnerCloneJob,
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
} from "../domain/remoteRunner";
import type {
  RepositoryHostsSnapshot,
  RepositoryInfo,
  RepositoryLookupOutcome,
  RepositoryLookupRequest,
} from "../domain/repositoryLookup";
import { remoteAgentProjectKey } from "./remoteAgentProjection";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import {
  useRemoteAddProject,
  type RemoteAddProjectServerProject,
  type RemoteAddProjectSession,
} from "./useRemoteAddProject";

const repository: RepositoryInfo = {
  provider: "github",
  host: "github.com",
  fullPath: "acme/storefront-api",
  description: "Storefront API service",
  visibility: "public",
  defaultBranch: "main",
  sshUrl: "git@github.com:acme/storefront-api.git",
  httpsUrl: "https://github.com/acme/storefront-api.git",
};

const snapshot: RepositoryHostsSnapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: {
    status: "ready",
    hosts: [{ provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" }],
    truncated: false,
  },
};

const descriptor: RemoteRunnerDescriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
};

const EXISTING_KEY = remoteAgentProjectKey("server-a", "runner", "existing");
const CLONED_KEY = remoteAgentProjectKey("server-a", "runner", "project-1");
const existingProject: RemoteAddProjectServerProject = {
  key: EXISTING_KEY,
  label: "existing-project",
};
const clonedProjectRow: RemoteAddProjectServerProject = {
  key: CLONED_KEY,
  label: "storefront-api",
};

const runningJob: RemoteRunnerCloneJob = {
  id: "clone-1",
  status: "running",
  project: null,
  error: null,
};
const succeededJob: RemoteRunnerCloneJob = {
  ...runningJob,
  status: "succeeded",
  project: { id: "project-1", name: "storefront-api" },
};

class FakeLookupGateway implements RepositoryLookupGateway {
  readonly requests: RepositoryLookupRequest[] = [];
  private readonly queue: ((outcome: RepositoryLookupOutcome) => void)[] = [];
  constructor(private readonly hosts: RepositoryHostsSnapshot = snapshot) {}

  async listHosts(): Promise<RepositoryHostsSnapshot> {
    return this.hosts;
  }

  lookup(request: RepositoryLookupRequest): Promise<RepositoryLookupOutcome> {
    this.requests.push(request);
    return new Promise<RepositoryLookupOutcome>((resolve) => {
      this.queue.push(resolve);
    });
  }

  settle(index: number, outcome: RepositoryLookupOutcome): void {
    const resolve = this.queue[index];
    expect(resolve, `pending lookup ${index}`).toBeDefined();
    resolve?.(outcome);
  }
}

let dispose: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
});

type SetupOverrides = Readonly<{
  session?: RemoteAddProjectSession;
  onCloneStarted?: (id: string, name: string, meta: Readonly<{ select: boolean }>) => void;
  onCloneReady?: (id: string, projectKey: string) => void;
  lookupGateway?: RepositoryLookupGateway | null;
  runnerGateway?: RemoteRunnerGateway | null;
  capabilities?: RemoteRunnerDescriptor["capabilities"];
  initialProjects?: readonly RemoteAddProjectServerProject[];
  projectsAfterRefresh?: readonly RemoteAddProjectServerProject[];
}>;

function setup(overrides: SetupOverrides = {}) {
  const lookupGateway =
    overrides.lookupGateway === undefined ? new FakeLookupGateway() : overrides.lookupGateway;
  const getRunner = vi.fn(async () => ({
    ...descriptor,
    capabilities: overrides.capabilities ?? descriptor.capabilities,
  }));
  const cloneProject = vi.fn(async () => runningJob);
  const getProjectClone = vi.fn(async () => runningJob);
  const cancelProjectClone = vi.fn(async () => ({ ...runningJob, status: "cancelled" }) as const);
  const connectedGateway = {
    getRunner,
    cloneProject,
    getProjectClone,
    cancelProjectClone,
  } as unknown as RemoteRunnerGateway;
  const runnerGateway =
    overrides.runnerGateway === undefined ? connectedGateway : overrides.runnerGateway;
  const initialProjects = overrides.initialProjects ?? [existingProject];
  const afterRefresh = overrides.projectsAfterRefresh ?? [...initialProjects, clonedProjectRow];
  const refreshProjects = vi.fn();
  const selectProject = vi.fn();
  const root = createRoot(document.createElement("div"));
  let result!: ReturnType<typeof useRemoteAddProject>;
  function Harness({
    server,
    connected,
    owner,
    identity,
  }: {
    server: string | null;
    connected: boolean;
    owner: string;
    identity: object;
  }) {
    const [serverProjects, setServerProjects] =
      useState<readonly RemoteAddProjectServerProject[]>(initialProjects);
    const refresh = useCallback(async () => {
      refreshProjects();
      await Promise.resolve();
      setServerProjects(afterRefresh);
    }, []);
    result = useRemoteAddProject({
      session: overrides.session,
      runnerGateway: connected ? runnerGateway : null,
      lookupGateway,
      serverId: server,
      workspaceOwner: owner,
      serverProjects,
      selectionIdentity: identity,
      refreshProjects: refresh,
      selectProject,
      onCloneStarted: overrides.onCloneStarted,
      onCloneReady: overrides.onCloneReady,
    });
    return null;
  }
  let identity = {};
  const render = (
    server: string | null = "server-a",
    connected = true,
    owner = "workspace-1",
    nextIdentity: object = identity,
    mountKey = "initial",
  ) => {
    identity = nextIdentity;
    return act(() =>
      root.render(
        <Harness
          key={mountKey}
          connected={connected}
          identity={identity}
          owner={owner}
          server={server}
        />,
      ),
    );
  };
  render();
  dispose = () => {
    dispose = () => undefined;
    act(() => root.unmount());
  };
  return {
    lookupGateway: lookupGateway as FakeLookupGateway,
    getRunner,
    cloneProject,
    getProjectClone,
    cancelProjectClone,
    refreshProjects,
    selectProject,
    render,
    unmount: () => dispose(),
    get result() {
      return result;
    },
  };
}

type View = ReturnType<typeof setup>;

async function openDialog(view: View) {
  await act(async () => {
    view.result.openDialog();
  });
}

async function reachConfirm(view: View, raw = "acme/storefront-api") {
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry(raw);
  });
  await act(async () => {
    view.lookupGateway.settle(0, { status: "ok", repository });
  });
}

async function settleClone() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

it("walks sources to confirm and clones with the chosen protocol and branch", async () => {
  const view = setup();
  await reachConfirm(view);
  expect(view.result.step).toMatchObject({ kind: "confirm", name: "storefront-api" });
  act(() => {
    view.result.setBranch(" release/2026.04 ");
    view.result.setProtocol("https");
  });
  await act(async () => {
    view.result.confirmClone();
  });
  expect(view.cloneProject).toHaveBeenCalledWith(
    expect.objectContaining({
      serverId: "server-a",
      url: "https://github.com/acme/storefront-api.git",
      name: "storefront-api",
      branch: "release/2026.04",
    }),
  );
  expect(view.result.open).toBe(false);
  expect(view.result.pendingClone).toEqual({
    id: "clone-1",
    name: "storefront-api",
    status: "running",
    error: null,
  });
});

it("selects the cloned project once it appears in the refreshed list", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await settleClone();
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  expect(view.selectProject).toHaveBeenCalledWith(CLONED_KEY);
});

it("does not refresh a new owner from the previous owner's completed clone", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await settleClone();
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.render("server-b");
  });
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  expect(view.result.pendingClone).toBeNull();
});

it("selects the first clone on a server that had no projects at all", async () => {
  const view = setup({ initialProjects: [], projectsAfterRefresh: [clonedProjectRow] });
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await settleClone();
  expect(view.selectProject).toHaveBeenCalledWith(CLONED_KEY);
});

it("waits for the project to appear instead of selecting a stale list", async () => {
  const view = setup({ projectsAfterRefresh: [existingProject] });
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await settleClone();
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  expect(view.selectProject).not.toHaveBeenCalled();
  expect(view.result.pendingClone).toMatchObject({ status: "succeeded" });
});

it("gives up the adoption when the selection identity changed while cloning", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await act(async () => {
    view.render("server-a", true, "workspace-1", {});
  });
  await settleClone();
  expect(view.selectProject).not.toHaveBeenCalled();
  expect(view.result.pendingClone).toMatchObject({ status: "succeeded" });
  act(() => {
    view.result.dismissPendingClone();
  });
  expect(view.result.pendingClone).toBeNull();
});

it("preserves navigation that changed before the clone request acknowledged", async () => {
  const view = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  view.cloneProject.mockImplementation(async () => {
    await gate;
    return runningJob;
  });
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  act(() => {
    view.result.confirmClone();
  });
  await act(async () => {
    view.render("server-a", true, "workspace-1", {});
  });
  await act(async () => {
    release();
    await gate;
  });
  await settleClone();
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("does not select the cloned project when the user picked another one first", async () => {
  const view = setup();
  view.getProjectClone.mockResolvedValue(succeededJob);
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  act(() => {
    view.result.selectServerProject(EXISTING_KEY);
  });
  await settleClone();
  expect(view.selectProject).toHaveBeenCalledTimes(1);
  expect(view.selectProject).toHaveBeenCalledWith(EXISTING_KEY);
});

it("resumes a tracked clone across server A to B to A without selecting", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  view.getProjectClone.mockResolvedValue(succeededJob);
  await act(async () => {
    view.render("server-b");
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.render("server-a");
  });
  expect(view.getProjectClone).toHaveBeenCalledWith({ serverId: "server-a", cloneId: "clone-1" });
  expect(view.result.pendingClone).toMatchObject({
    name: "storefront-api",
    status: "succeeded",
  });
  expect(view.refreshProjects).toHaveBeenCalledTimes(1);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("keeps a clone row out of another workspace tab on the same server", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  expect(view.result.pendingClone).not.toBeNull();
  await act(async () => {
    view.render("server-a", true, "workspace-2");
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.result.cancelPendingClone();
  });
  expect(view.cancelProjectClone).not.toHaveBeenCalled();
  await act(async () => {
    view.render("server-a", true, "workspace-1");
  });
  expect(view.result.pendingClone).not.toBeNull();
});

it("remembers a clone that resolved after the owner changed", async () => {
  const view = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  view.cloneProject.mockImplementation(async () => {
    await gate;
    return runningJob;
  });
  await reachConfirm(view);
  act(() => {
    view.result.confirmClone();
  });
  await act(async () => {
    view.render("server-b");
  });
  await act(async () => {
    release();
    await gate;
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.render("server-a");
  });
  expect(view.getProjectClone).toHaveBeenCalledWith({ serverId: "server-a", cloneId: "clone-1" });
  expect(view.result.pendingClone).toMatchObject({ name: "storefront-api" });
});

it("ignores a second confirm in the same tick instead of reporting a busy server", async () => {
  const view = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  view.cloneProject.mockImplementation(async () => {
    await gate;
    return runningJob;
  });
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
    view.result.confirmClone();
  });
  expect(view.result.step).toMatchObject({ submitting: true, submitError: null });
  await act(async () => {
    release();
    await gate;
  });
  expect(view.cloneProject).toHaveBeenCalledTimes(1);
  expect(view.result.open).toBe(false);
  expect(view.result.pendingClone).toMatchObject({ status: "running", error: null });
});

it("maps a runner name conflict to a taken folder name", async () => {
  const view = setup();
  view.cloneProject.mockRejectedValueOnce(new Error("Runner request failed (HTTP 409)."));
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  expect(view.result.open).toBe(true);
  expect(view.result.step).toMatchObject({
    kind: "confirm",
    nameError: "taken",
    submitError: null,
    submitting: false,
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.result.setName("storefront-api-2");
  });
  expect(view.result.step).toMatchObject({ nameError: null });
});

it("bounds any other clone failure into the confirm step", async () => {
  const view = setup();
  view.cloneProject.mockRejectedValueOnce(new Error("z".repeat(500)));
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  const step = view.result.step;
  expect(step.kind === "confirm" && step.submitError?.length).toBe(200);
  expect(view.result.pendingClone).toBeNull();
});

it("keeps a submit failure visible in the rail once the dialog is closed", async () => {
  const view = setup();
  view.cloneProject.mockRejectedValueOnce(new Error("runner unreachable"));
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.result.close();
  });
  expect(view.result.pendingClone).toEqual({
    name: "storefront-api",
    status: "failed",
    error: "runner unreachable",
  });
  act(() => {
    view.result.dismissPendingClone();
  });
  expect(view.result.pendingClone).toBeNull();
});

it("offers the existing server project when the folder name is taken locally", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => {
    view.result.setName("existing-project");
  });
  expect(view.result.step).toMatchObject({ existingProjectKey: EXISTING_KEY });
  act(() => {
    view.result.openExisting();
  });
  expect(view.selectProject).toHaveBeenCalledWith(EXISTING_KEY);
  expect(view.result.open).toBe(false);
});

it("moves to the git url step from a failed lookup", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  await act(async () => {
    view.lookupGateway.settle(0, { status: "notFound" });
  });
  expect(view.result.step).toMatchObject({ kind: "repository" });
  act(() => {
    view.result.useGitUrl();
  });
  expect(view.result.step).toEqual({ kind: "urlEntry", entry: "", lookup: { status: "idle" } });
  await act(async () => {
    view.result.submitEntry("git@github.com:acme/storefront-api.git");
  });
  expect(view.result.step).toMatchObject({ kind: "confirm", name: "storefront-api" });
});

it("drops a lookup that settles after the dialog closed", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  act(() => {
    view.result.close();
  });
  await act(async () => {
    view.lookupGateway.settle(0, { status: "ok", repository });
  });
  expect(view.result.open).toBe(false);
  expect(view.result.step).toEqual({ kind: "sources" });
});

it("keeps only the latest of two reordered lookups", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  await act(async () => {
    view.result.submitEntry("acme/other-api");
  });
  await act(async () => {
    view.lookupGateway.settle(1, { status: "notFound" });
    view.lookupGateway.settle(0, { status: "ok", repository });
  });
  expect(view.result.step).toMatchObject({
    kind: "repository",
    lookup: { status: "settled", outcome: { status: "notFound" } },
  });
});

it("settles a superseded lookup of the current generation as busy", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  await act(async () => {
    view.lookupGateway.settle(0, { status: "superseded" });
  });
  expect(view.result.step).toMatchObject({
    lookup: { status: "settled", outcome: { status: "failed", reason: "busy" } },
  });
});

it("rejects an unparseable entry without calling the gateway", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/team/storefront");
  });
  expect(view.lookupGateway.requests).toEqual([]);
  expect(view.result.step).toMatchObject({
    lookup: { status: "rejectedInput", reason: "invalidPath" },
  });
});

it("skips the lookup for a clone url typed into the repository step", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("git@github.com:acme/storefront-api.git");
  });
  expect(view.lookupGateway.requests).toEqual([]);
  expect(view.result.step).toMatchObject({ kind: "confirm", name: "storefront-api" });
});

it("never reaches a lookup without a lookup gateway", async () => {
  const view = setup({ lookupGateway: null });
  await openDialog(view);
  expect(view.result.availability).toEqual({
    serverProject: { status: "ready" },
    gitUrl: { status: "ready" },
    github: { status: "unavailable", reason: "lookupUnavailable" },
    gitlab: { status: "unavailable", reason: "lookupUnavailable" },
  });
  act(() => {
    view.result.chooseSource("github");
  });
  expect(view.result.step).toEqual({ kind: "sources" });
});

it("disables every clone source when the runner cannot clone", async () => {
  const view = setup({ capabilities: { taskExecution: true, eventReplay: true } });
  await openDialog(view);
  expect(view.result.availability.gitUrl).toEqual({
    status: "unavailable",
    reason: "cloningUnsupported",
  });
});

it("reports an unreachable server as probeFailed and retries it", async () => {
  const view = setup();
  view.getRunner.mockRejectedValueOnce(new Error("offline"));
  await openDialog(view);
  expect(view.result.availability.gitUrl).toEqual({
    status: "unavailable",
    reason: "probeFailed",
  });
  await act(async () => {
    view.result.retrySources();
  });
  expect(view.result.availability.gitUrl).toEqual({ status: "ready" });
});

it("cancels and dismisses a pending clone", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => {
    view.result.confirmClone();
  });
  await act(async () => {
    view.result.cancelPendingClone();
  });
  expect(view.cancelProjectClone).toHaveBeenCalledWith({
    serverId: "server-a",
    cloneId: "clone-1",
  });
  expect(view.result.pendingClone).toMatchObject({ status: "cancelled" });
  act(() => {
    view.result.dismissPendingClone();
  });
  expect(view.result.pendingClone).toBeNull();
  await act(async () => {
    view.render("server-b");
  });
  await act(async () => {
    view.render("server-a");
  });
  expect(view.result.pendingClone).toBeNull();
});

it("refuses to clone without a selected server", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => {
    view.render(null);
  });
  await act(async () => {
    view.result.confirmClone();
  });
  expect(view.cloneProject).not.toHaveBeenCalled();
});

it("reports every clone source unsupported without a runner gateway", async () => {
  const view = setup({ runnerGateway: null });
  await openDialog(view);
  expect(view.getRunner).not.toHaveBeenCalled();
  const unsupported = { status: "unavailable", reason: "cloningUnsupported" };
  expect(view.result.availability).toEqual({
    serverProject: { status: "ready" },
    gitUrl: unsupported,
    github: unsupported,
    gitlab: unsupported,
  });
});

it("cannot confirm a clone without a runner gateway", async () => {
  const view = setup({ runnerGateway: null });
  await openDialog(view);
  expect(view.result.step).toEqual({ kind: "sources" });
  expect(view.cloneProject).not.toHaveBeenCalled();
});

it("drops a lookup that settles after the runner gateway disappeared", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  await act(async () => {
    view.render("server-a", false);
  });
  await act(async () => {
    view.lookupGateway.settle(0, { status: "ok", repository });
  });
  expect(view.result.open).toBe(false);
  expect(view.result.step).toEqual({ kind: "sources" });
});

it("survives an unmount while a lookup is in flight", async () => {
  const view = setup();
  await openDialog(view);
  act(() => {
    view.result.chooseSource("github");
  });
  await act(async () => {
    view.result.submitEntry("acme/storefront-api");
  });
  view.unmount();
  await act(async () => {
    view.lookupGateway.settle(0, { status: "ok", repository });
  });
  expect(view.result.step).toMatchObject({ kind: "repository", lookup: { status: "pending" } });
});

it("opens the pending draft and reports readiness without stealing subsequent navigation", async () => {
  const onCloneStarted = vi.fn();
  const onCloneReady = vi.fn();
  const view = setup({ onCloneStarted, onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  expect(onCloneStarted).toHaveBeenCalledWith("clone-1", "storefront-api", { select: true });
  view.render("server-a", true, "workspace-1", {});
  view.getProjectClone.mockResolvedValue(succeededJob);
  await settleClone();
  expect(onCloneReady).toHaveBeenCalledWith("clone-1", CLONED_KEY);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("does not open a draft when navigation changed during clone acknowledgement", async () => {
  const onCloneStarted = vi.fn();
  const view = setup({ onCloneStarted });
  await reachConfirm(view);
  let resolve!: (job: RemoteRunnerCloneJob) => void;
  view.cloneProject.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => view.result.confirmClone());
  view.render("server-a", true, "workspace-1", {});
  await act(async () => resolve(runningJob));
  expect(onCloneStarted).toHaveBeenCalledWith("clone-1", "storefront-api", { select: false });
  expect(view.result.pendingClone?.id).toBe("clone-1");
});

it("retries a failed clone with its original input and a new operation key", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.getProjectClone.mockResolvedValue({ ...runningJob, status: "failed", error: "network" });
  await settleClone();
  await act(async () => view.result.retryPendingClone());
  expect(view.cloneProject).toHaveBeenCalledTimes(2);
  const first = view.cloneProject.mock.calls[0];
  const second = view.cloneProject.mock.calls[1];
  expect(second).not.toEqual(first);
  expect(second).toMatchObject([
    { serverId: "server-a", name: "storefront-api", url: repository.sshUrl },
  ]);
});

it("restores exact-owner draft readiness after server A to B to A", async () => {
  const onCloneReady = vi.fn();
  const view = setup({ onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.render("server-b");
  view.getProjectClone.mockResolvedValue(succeededJob);
  await act(async () => view.render("server-a"));
  await settleClone();
  expect(onCloneReady).toHaveBeenCalledWith("clone-1", CLONED_KEY);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("restores retry input after returning to the original clone owner", async () => {
  const view = setup({ onCloneReady: vi.fn() });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.render("server-b");
  view.getProjectClone.mockResolvedValue({ ...runningJob, status: "failed", error: "network" });
  await act(async () => view.render("server-a"));
  await settleClone();
  expect(view.result.canRetryPendingClone).toBe(true);
  await act(async () => view.result.retryPendingClone());
  expect(view.cloneProject).toHaveBeenCalledTimes(2);
});

it("retains runner authority when retrying after a server round trip", async () => {
  const onCloneReady = vi.fn();
  const view = setup({ onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.render("server-b");
  view.getProjectClone.mockResolvedValue({ ...runningJob, status: "failed", error: "network" });
  await act(async () => view.render("server-a"));
  await settleClone();
  view.cloneProject.mockResolvedValue({ ...runningJob, id: "clone-2" });
  view.getProjectClone.mockResolvedValue({ ...succeededJob, id: "clone-2" });
  await act(async () => view.result.retryPendingClone());
  await settleClone();
  expect(onCloneReady).toHaveBeenCalledWith("clone-2", CLONED_KEY);
});

it("revokes retry on dismiss even for a retained callback", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.getProjectClone.mockResolvedValue({ ...runningJob, status: "failed", error: "network" });
  await settleClone();
  const retry = view.result.retryPendingClone;
  act(() => view.result.dismissPendingClone());
  await act(async () => retry());
  expect(view.cloneProject).toHaveBeenCalledTimes(1);
});

it("delivers completed draft readiness once across repeated server navigation", async () => {
  const onCloneReady = vi.fn();
  const view = setup({ onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.getProjectClone.mockResolvedValue(succeededJob);
  await settleClone();
  view.render("server-b");
  await act(async () => view.render("server-a"));
  await settleClone();
  expect(onCloneReady).toHaveBeenCalledTimes(1);
});

it("can retry a retained operation interrupted by the server", async () => {
  const view = setup();
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.getProjectClone.mockResolvedValue({
    ...runningJob,
    status: "interrupted",
    error: "Server restarted",
  });
  await settleClone();
  expect(view.result.canRetryPendingClone).toBe(true);
  await act(async () => view.result.retryPendingClone());
  expect(view.cloneProject).toHaveBeenCalledTimes(2);
});

it("restores server clone readiness across keyed workspace leaf remount", async () => {
  const session: RemoteAddProjectSession = { current: null };
  const onCloneReady = vi.fn();
  const view = setup({ session, onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  await act(async () => view.render("server-a", true, "workspace-1", {}, "leaf-b"));
  view.getProjectClone.mockResolvedValue(succeededJob);
  await settleClone();
  expect(view.result.pendingClone?.projectKey).toBe(CLONED_KEY);
  expect(onCloneReady).toHaveBeenCalledWith("clone-1", CLONED_KEY);
  expect(view.selectProject).not.toHaveBeenCalled();
  expect(view.cloneProject).toHaveBeenCalledTimes(1);
});

it("recovers the first clone acknowledgement on the new leaf without selecting it", async () => {
  const session: RemoteAddProjectSession = { current: null };
  const onCloneStarted = vi.fn();
  const onCloneReady = vi.fn();
  const view = setup({ session, onCloneStarted, onCloneReady });
  await reachConfirm(view);
  let resolve!: (job: RemoteRunnerCloneJob) => void;
  view.cloneProject.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => view.result.confirmClone());
  await act(async () => view.render("server-a", true, "workspace-1", {}, "leaf-b"));
  await act(async () => resolve(succeededJob));
  await settleClone();
  expect(onCloneStarted).toHaveBeenCalledWith("clone-1", "storefront-api", { select: false });
  expect(onCloneReady).toHaveBeenCalledWith("clone-1", CLONED_KEY);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("restores the retried job rather than the failed submission across pending acknowledgement remount", async () => {
  const session: RemoteAddProjectSession = { current: null };
  const onCloneReady = vi.fn();
  const view = setup({ session, onCloneReady });
  await reachConfirm(view);
  await act(async () => view.result.confirmClone());
  view.getProjectClone.mockResolvedValue({ ...runningJob, status: "failed", error: "network" });
  await settleClone();
  let resolve!: (job: RemoteRunnerCloneJob) => void;
  view.cloneProject.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => view.result.retryPendingClone());
  await act(async () => view.render("server-a", true, "workspace-1", {}, "retry-leaf"));
  await act(async () => resolve({ ...succeededJob, id: "clone-retry" }));
  await settleClone();
  expect(onCloneReady).toHaveBeenCalledWith("clone-retry", CLONED_KEY);
  expect(view.selectProject).not.toHaveBeenCalled();
});

it("sends the selected server directory and retains it for a clone retry", async () => {
  const view = setup();
  await reachConfirm(view);
  act(() => view.result.setParentPath!("/srv/projects/custom"));
  expect(view.result.parentPath).toBe("/srv/projects/custom");
  act(() => view.result.setParentPath!("/srv/projects/../private"));
  expect(view.result.parentPath).toBe("/srv/projects/custom");
  view.cloneProject.mockResolvedValueOnce({
    ...runningJob,
    status: "failed",
    error: "temporary failure",
  });
  await act(async () => view.result.confirmClone());
  expect(view.cloneProject).toHaveBeenCalledWith(
    expect.objectContaining({ serverId: "server-a", parentPath: "/srv/projects/custom" }),
  );
  await act(async () => view.result.retryPendingClone());
  expect(view.cloneProject).toHaveBeenLastCalledWith(
    expect.objectContaining({ serverId: "server-a", parentPath: "/srv/projects/custom" }),
  );
});

it("does not carry a destination or selected repository into another server generation", async () => {
  const view = setup();
  await reachConfirm(view);
  act(() => view.result.setParentPath!("/srv/projects/custom"));
  const stale = view.result;
  await view.render("server-b");
  expect(view.result.parentPath).toBeNull();
  act(() => {
    stale.setParentPath!("/srv/old");
    stale.chooseRepository!(repository);
  });
  expect(view.result.parentPath).toBeNull();
  expect(view.result.open).toBe(false);
});
