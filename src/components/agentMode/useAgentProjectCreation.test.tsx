// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkbenchAddProjectChrome } from "./agentWorkbenchChrome";
import type { AgentProjectCreationSession } from "./agentProjectCreationSession";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import type { LocalProjectCloneGateway } from "../../application/ports/localProjectCloneGateway";
import type { LocalProjectCloneSnapshot } from "../../domain/localProjectClone";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { useLocalProjectClone } from "../../application/useLocalProjectClone";
import type { useRemoteAddProject } from "../../application/useRemoteAddProject";
import type { useAgentAddProject } from "./useAgentAddProject";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { useAgentProjectCreation } from "./useAgentProjectCreation";
const state = vi.hoisted(() => ({
  localJob: null as LocalProjectCloneSnapshot | null,
  localError: null as string | null,
  local: null as unknown as Parameters<typeof useLocalProjectClone>[0],
  remote: null as unknown as Parameters<typeof useRemoteAddProject>[0],
  add: null as unknown as Parameters<typeof useAgentAddProject>[0],
  addProject: vi.fn(),
  dismiss: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../application/useLocalProjectClone", () => ({
  useLocalProjectClone: (options: typeof state.local) => {
    state.local = options;
    return {
      job: state.localJob,
      error: state.localError,
      busy: false,
      dismiss: state.dismiss,
      retry: state.retry,
      cancel: vi.fn(),
    };
  },
}));
vi.mock("../../application/useRemoteAddProject", () => ({
  useRemoteAddProject: (options: typeof state.remote) => {
    state.remote = options;
    return {
      pendingClone: null,
      openDialog: vi.fn(),
      chooseSource: vi.fn(),
      dismissPendingClone: state.dismiss,
      retryPendingClone: state.retry,
    };
  },
}));
vi.mock("./useAgentAddProject", () => ({
  useAgentAddProject: (options: typeof state.add) => {
    state.add = options;
    return { addProject: state.addProject, openDialog: vi.fn() };
  },
}));
vi.mock("../remoteRunner/remoteRunnerContext", () => ({ useRemoteRunnerContext: () => null }));
let root: Root;
let host: HTMLElement;
const project = {
  rootKey: "remote:srv:runner:project",
  rootPath: "remote:srv:runner:project",
  label: "Repo",
  ownerId: "owner",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
} as AgentProjectDescriptor;
let current: ReturnType<typeof useAgentProjectCreation>;
let identity: object;
let workspaceRoot: string | null;
let chrome: AgentWorkbenchAddProjectChrome | null;
const onAdded = vi.fn();
function Harness() {
  current = useAgentProjectCreation({
    chrome,
    projects: [project],
    workspaceRoot,
    selectionIdentity: identity,
    selectedServerId: "srv",
    onProjectAdded: onAdded,
    reportNotice: vi.fn(),
    refreshProjects: async () => {},
  });
  return null;
}
function render() {
  act(() => root.render(<Harness />));
}
function start(id = "job") {
  act(() => state.remote.onCloneStarted?.(id, "Repo", { select: true }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.localJob = null;
  state.localError = null;
  agentComposerDraftStore.reset();
  identity = {};
  workspaceRoot = "/work";
  chrome = null;
  host = document.createElement("div");
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
describe("clone draft coordination", () => {
  it("preserves pending draft across navigation and merges exact destination once", () => {
    start();
    act(() => current.changeDraft("new request"));
    identity = {};
    render();
    expect(current.visible).toBe(false);
    expect(current.draft).toBe("new request");
    act(() => state.remote.onCloneReady?.("job", project.rootKey));
    agentComposerDraftStore.writeDraft(`new:${project.rootKey}`, "existing request");
    act(() => current.continueDraft());
    expect(agentComposerDraftStore.readDraft(`new:${project.rootKey}`)).toBe(
      "existing request\n\nnew request",
    );
    expect(onAdded).toHaveBeenCalledOnce();
    expect(current.pending).toBeNull();
    act(() => current.continueDraft());
    expect(onAdded).toHaveBeenCalledOnce();
  });
  it("retains even oversized text through retry and blocks overflow transfer", () => {
    start();
    const text = "é".repeat(150000);
    act(() => current.changeDraft(text));
    act(() => current.retry());
    start("retry");
    expect(current.draft).toBe(text);
    act(() => state.remote.onCloneReady?.("retry", project.rootKey));
    act(() => current.continueDraft());
    expect(onAdded).not.toHaveBeenCalled();
    expect(current.error).toContain("too long");
    expect(current.draft).toBe(text);
  });
  it("does not retarget pending clone when another server is chosen", () => {
    start();
    act(() => current.choose("other", "existing"));
    expect(state.remote.serverId).toBe("srv");
    expect(current.pending?.environment).toBe("srv");
    expect(current.existingServerProjects).toEqual([]);
  });
  it("keeps remote clone tracking in its original workspace while local folders change", () => {
    start();
    act(() => current.changeDraft("keep me"));
    workspaceRoot = "/other";
    identity = {};
    render();
    expect(state.remote.workspaceOwner).toBe("/work");
    expect(current.draft).toBe("keep me");
    act(() => state.remote.onCloneReady?.("job", project.rootKey));
    act(() => current.continueDraft());
    expect(onAdded).toHaveBeenCalledWith(project);
  });
  it("ignores readiness for another job and does not select late acknowledged clone", () => {
    act(() => state.remote.onCloneStarted?.("late", "Repo", { select: false }));
    expect(current.visible).toBe(false);
    act(() => state.remote.onCloneReady?.("foreign", project.rootKey));
    expect(current.pending?.target).toBeNull();
  });
  it("does not carry a status retry draft into a subsequent unrelated clone", () => {
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    state.localJob = { cloneId: "local", status: "running", path: "/clone", error: null };
    state.localError = "offline";
    render();
    act(() => current.changeDraft("first request"));
    act(() => current.retry());
    state.localJob = { cloneId: "local", status: "completed", path: "/clone", error: null };
    render();
    act(() => state.local.onReady("local", "/clone"));
    act(() => current.continueDraft());
    act(() => state.add.onProjectAdded({ ...project, rootKey: "/clone", rootPath: "/clone" }));
    expect(current.pending).toBeNull();
    act(() => state.local.onStarted("another", "Other", { select: true }));
    expect(current.draft).toBe("");
  });
  it("abandons stale local receipt before an ordinary folder open", () => {
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    state.localJob = { cloneId: "local", status: "completed", path: "/clone", error: null };
    render();
    act(() => state.local.onReady("local", "/clone"));
    act(() => current.continueDraft());
    expect(state.addProject).toHaveBeenCalledWith("/clone");
    act(() => current.choose(null, "existing"));
    act(() => state.add.onProjectAdded(project));
    expect(onAdded).toHaveBeenCalledWith(project);
  });
  it("stages a completed native clone draft before opening and never appends twice after refusal", () => {
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    state.localJob = { cloneId: "local", status: "completed", path: "/clone", error: null };
    render();
    act(() => state.local.onReady("local", "/clone"));
    agentComposerDraftStore.writeDraft("new:/clone", "existing");
    act(() => current.changeDraft("new request"));
    state.addProject.mockImplementationOnce(() => {
      expect(agentComposerDraftStore.readDraft("new:/clone")).toBe("existing\n\nnew request");
    });
    act(() => current.continueDraft());
    act(() => current.continueDraft());
    expect(agentComposerDraftStore.readDraft("new:/clone")).toBe("existing\n\nnew request");
    expect(agentComposerDraftStore.readDraft("clone:local:local")).toBe("new request");
  });
  it("refuses opening before native completion or when merged local draft exceeds the limit", () => {
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    act(() => state.local.onReady("local", "/clone"));
    act(() => current.continueDraft());
    expect(state.addProject).not.toHaveBeenCalled();
    state.localJob = { cloneId: "local", status: "completed", path: "/clone", error: null };
    render();
    act(() => current.changeDraft("é".repeat(20000)));
    act(() => current.continueDraft());
    expect(state.addProject).not.toHaveBeenCalled();
    expect(current.error).toContain("too long");
  });
  it("restores a private pending clone across leaf remount only for its exact gateway", () => {
    const session: AgentProjectCreationSession = { current: null };
    const gateway = {
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    } satisfies LocalProjectCloneGateway;
    chrome = {
      gateway: {} as DirectoryListingGateway,
      cloneGateway: gateway,
      creationSession: session,
      addProject: vi.fn(),
    };
    render();
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    act(() => current.changeDraft("survives actual leaf removal"));
    act(() => root.unmount());
    root = createRoot(host);
    workspaceRoot = "/other";
    render();
    expect(current.pending?.id).toBe("local");
    expect(current.draft).toBe("survives actual leaf removal");
    expect(current.visible).toBe(false);
    act(() => state.local.onStarted("local", "Repo", { select: false }));
    expect(current.draft).toBe("survives actual leaf removal");
    act(() => root.unmount());
    root = createRoot(host);
    chrome = { ...chrome, cloneGateway: { start: vi.fn(), get: vi.fn(), cancel: vi.fn() } };
    render();
    expect(current.pending).toBeNull();
    expect(session.current).toBeNull();
  });
  it("consumes the pending restoration snapshot before a successful local open remounts", () => {
    const session: AgentProjectCreationSession = { current: null };
    chrome = {
      gateway: {} as DirectoryListingGateway,
      creationSession: session,
      addProject: vi.fn(),
    };
    render();
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    state.localJob = { cloneId: "local", status: "completed", path: "/clone", error: null };
    render();
    act(() => state.local.onReady("local", "/clone"));
    act(() => current.changeDraft("keep"));
    state.addProject.mockImplementationOnce(() => expect(session.current).toBeNull());
    act(() => current.continueDraft());
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(current.pending).toBeNull();
    expect(agentComposerDraftStore.readDraft("new:/clone")).toBe("keep");
  });
  it("retains a remote clone's null workspace owner across leaf remount", () => {
    const session: AgentProjectCreationSession = { current: null };
    chrome = {
      gateway: {} as DirectoryListingGateway,
      creationSession: session,
      addProject: vi.fn(),
    };
    act(() => root.unmount());
    root = createRoot(host);
    workspaceRoot = null;
    render();
    start();
    expect(state.remote.workspaceOwner).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    workspaceRoot = "/other";
    render();
    expect(state.remote.workspaceOwner).toBeNull();
    expect(current.pending?.id).toBe("job");
  });
  it("preserves oversized in-memory draft and completed target during native restoration callbacks", () => {
    act(() => state.local.onStarted("local", "Repo", { select: true }));
    const text = "é".repeat(100000);
    act(() => current.changeDraft(text));
    act(() => state.local.onReady("local", "/clone"));
    act(() => state.local.onStarted("local", "Repo", { select: false }));
    expect(current.draft).toBe(text);
    expect(current.pending?.target).toEqual({ kind: "local", path: "/clone" });
  });
});
