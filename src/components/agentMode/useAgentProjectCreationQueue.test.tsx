// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentProjectCreation } from "./useAgentProjectCreation";
import type { AgentWorkbenchAddProjectChrome } from "./agentWorkbenchChrome";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { LocalProjectCloneSnapshot } from "../../domain/localProjectClone";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";

vi.mock("../remoteRunner/remoteRunnerContext", () => ({ useRemoteRunnerContext: () => null }));
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useAgentProjectCreation>;
let chrome: AgentWorkbenchAddProjectChrome;
let selection = {};
let completeImmediately = false;
let projects: readonly AgentProjectDescriptor[] = [];
const onAdded = vi.fn();
const jobs = new Map<string, LocalProjectCloneSnapshot>();
const start = vi.fn(async (request: { idempotencyKey: string; name: string }) => {
  const snapshot = {
    cloneId: request.idempotencyKey,
    status: completeImmediately ? ("completed" as const) : ("running" as const),
    path: `/work/${request.name}`,
    error: null,
  };
  jobs.set(snapshot.cloneId, snapshot);
  return snapshot;
});
const cancel = vi.fn(async ({ cloneId }: { cloneId: string }) => {
  const snapshot = { cloneId, status: "cancelled" as const, path: null, error: null };
  jobs.set(cloneId, snapshot);
  return snapshot;
});
function Harness() {
  current = useAgentProjectCreation({
    chrome,
    projects,
    workspaceRoot: "/work",
    selectionIdentity: selection,
    selectedServerId: null,
    onProjectAdded: onAdded,
    reportNotice: vi.fn(),
    refreshProjects: async () => {},
  });
  return null;
}
function render() {
  act(() => root.render(<Harness />));
}
async function clone(name: string) {
  act(() => current.choose(null, "clone"));
  await act(async () =>
    current.local.start({ url: "https://github.com/example/repo.git", name, parentPath: "/work" }),
  );
  return current.pending!.id;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  jobs.clear();
  agentComposerDraftStore.reset();
  selection = {};
  completeImmediately = false;
  projects = [];
  chrome = {
    gateway: {} as AgentWorkbenchAddProjectChrome["gateway"],
    cloneGateway: { start, get: async ({ cloneId }) => jobs.get(cloneId)!, cancel },
    creationSession: { current: null },
    localCloneSession: { current: null },
    remoteCloneSession: { current: null },
    addProject: vi.fn(),
  };
  host = document.createElement("div");
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("owns four simultaneous clones and retains separate drafts through navigation and remount", async () => {
  const first = await clone("one");
  act(() => current.changeDraft("first prompt"));
  const second = await clone("two");
  act(() => current.changeDraft("second prompt"));
  await clone("three");
  await clone("four");
  expect(start).toHaveBeenCalledTimes(4);
  expect(current.pendingClones).toHaveLength(4);
  act(() => current.choose(null, "clone"));
  expect(current.capacityError).toContain("up to 4");
  act(() => current.showPending(second));
  expect(current.draft).toBe("second prompt");
  act(() => root.unmount());
  root = createRoot(host);
  selection = {};
  render();
  expect(current.pending?.id).toBe(second);
  expect(current.draft).toBe("second prompt");
  expect(current.visible).toBe(false);
  expect(current.pendingClones).toHaveLength(4);
  act(() => current.showPending(first));
  expect(current.draft).toBe("first prompt");
});
it("cancels only the selected clone, cannot remove running clones, and releases settled slots", async () => {
  const first = await clone("one");
  const second = await clone("two");
  act(() => current.showPending(first));
  act(() => current.dismiss());
  expect(current.pendingClones).toHaveLength(2);
  await act(async () => {
    current.cancel();
  });
  expect(cancel).toHaveBeenCalledWith({ cloneId: first });
  expect(jobs.get(second)?.status).toBe("running");
  act(() => current.dismiss());
  expect(current.pendingClones).toHaveLength(1);
  await clone("replacement");
  expect(current.pendingClones).toHaveLength(2);
});
it("does not adopt results after a gateway owner is replaced", async () => {
  await clone("one");
  await clone("two");
  chrome = { ...chrome, cloneGateway: { start: vi.fn(), get: vi.fn(), cancel: vi.fn() } };
  render();
  expect(current.pendingClones).toHaveLength(0);
  expect(current.pending).toBeNull();
});

it("routes delayed project registration to its initiating clone after another clone is selected", async () => {
  completeImmediately = true;
  const first = await clone("one");
  let deliver!: (value: Awaited<ReturnType<AgentWorkbenchAddProjectChrome["addProject"]>>) => void;
  chrome = {
    ...chrome,
    addProject: vi.fn(
      () =>
        new Promise<Awaited<ReturnType<AgentWorkbenchAddProjectChrome["addProject"]>>>(
          (resolve) => {
            deliver = resolve;
          },
        ),
    ),
  };
  render();
  act(() => current.activateCompleted());
  completeImmediately = false;
  const second = await clone("two");
  act(() => current.activateCompleted());
  const project = {
    rootKey: "/work/one",
    rootPath: "/work/one",
    ownerId: "owner-one",
    generation: 1,
    label: "one",
    trust: "trusted",
    origin: "active-tab",
  } as AgentProjectDescriptor;
  projects = [project];
  let valid = true;
  const receipt = { rootPath: project.rootPath, ownerId: project.ownerId, isCurrent: () => valid };
  chrome = {
    ...chrome,
    receipt,
    consumeSelection: () => {
      valid = false;
    },
  };
  await act(async () => {
    render();
    deliver(receipt);
  });
  expect(onAdded).not.toHaveBeenCalled();
  expect(current.pending?.id).toBe(second);
  act(() => current.showPending(first));
  expect(current.completedProject).toBe(project);
});
it("allows retry after project registration fails without restarting the completed clone", async () => {
  completeImmediately = true;
  await clone("one");
  const addProject = vi.fn().mockRejectedValueOnce(new Error("Temporary opening failure"));
  chrome = { ...chrome, addProject };
  render();
  await act(async () => {
    current.activateCompleted();
  });
  expect(current.error).toContain("Temporary opening failure");
  act(() => current.activateCompleted());
  expect(addProject).toHaveBeenCalledTimes(1);
  const project = {
    rootKey: "/work/one",
    rootPath: "/work/one",
    ownerId: "owner-one",
    generation: 1,
    label: "one",
    trust: "trusted",
    origin: "active-tab",
  } as AgentProjectDescriptor;
  projects = [project];
  addProject.mockResolvedValueOnce({
    rootPath: project.rootPath,
    ownerId: project.ownerId,
    isCurrent: () => true,
  });
  act(() => current.retry());
  await act(async () => {
    current.activateCompleted();
  });
  expect(addProject).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledTimes(1);
  expect(current.completedProject).toBe(project);
});

it("targets sidebar cancellation and removal without changing the selected draft", async () => {
  const first = await clone("one");
  const firstRow = current.pendingClones[0].id;
  const second = await clone("two");
  act(() => current.changeDraft("second remains selected"));
  await act(async () => {
    current.cancel(firstRow);
  });
  expect(cancel).toHaveBeenCalledWith({ cloneId: first });
  expect(current.pending?.id).toBe(second);
  expect(current.draft).toBe("second remains selected");
  act(() => current.dismiss(firstRow));
  expect(current.pending?.id).toBe(second);
  expect(current.pendingClones).toHaveLength(1);
});

it("does not carry an opening failure into a new clone reusing the same lane", async () => {
  completeImmediately = true;
  await clone("one");
  const addProject = vi.fn().mockRejectedValue(new Error("Opening failed"));
  chrome = { ...chrome, addProject };
  render();
  await act(async () => {
    current.activateCompleted();
  });
  act(() => current.dismiss());
  await clone("two");
  await act(async () => {
    current.activateCompleted();
  });
  expect(addProject).toHaveBeenCalledTimes(2);
  expect(addProject).toHaveBeenLastCalledWith("/work/two");
});
