// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentAddProject, type AgentAddProjectOptions } from "./useAgentAddProject";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { DirectoryListingGateway } from "../../domain/directoryListing";

const project: AgentProjectDescriptor = {
  rootKey: "/canonical/new",
  rootPath: "/canonical/new",
  ownerId: "registered-new",
  label: "new",
  generation: 2,
  trust: "trusted",
  origin: "active-tab",
  repositories: [],
  isolationPolicy: "auto",
  leaseToken: null,
};

describe("agent add project selection", () => {
  let root: Root;
  let current: ReturnType<typeof useAgentAddProject>;
  let options: AgentAddProjectOptions;
  let complete: (value: { rootPath: string; ownerId: string; isCurrent(): boolean }) => void;
  let reject: (error: Error) => void;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    const pending = new Promise<{ rootPath: string; ownerId: string; isCurrent(): boolean }>(
      (resolve, fail) => {
        complete = resolve;
        reject = fail;
      },
    );
    options = {
      chrome: { gateway: {} as DirectoryListingGateway, addProject: vi.fn(() => pending) },
      projects: [],
      workspaceRoot: "/old",
      selectionIdentity: {},
      onProjectAdded: vi.fn(),
      reportNotice: vi.fn(),
    };
  });
  afterEach(() => act(() => root.unmount()));
  function Harness() {
    current = useAgentAddProject(options);
    return null;
  }
  function render() {
    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
  }
  function start() {
    render();
    act(() => current.addProject("/alias/new"));
  }
  async function finish() {
    await act(async () =>
      complete({ rootPath: project.rootPath, ownerId: project.ownerId, isCurrent: () => true }),
    );
  }

  it("waits for the exact canonical registered project and selects once", async () => {
    start();
    await finish();
    options = { ...options, projects: [{ ...project, ownerId: "foreign" }] };
    render();
    expect(options.onProjectAdded).not.toHaveBeenCalled();
    options = { ...options, projects: [project] };
    render();
    render();
    expect(options.onProjectAdded).toHaveBeenCalledExactlyOnceWith(project);
  });
  it("accepts descriptor publication before open settlement", async () => {
    start();
    options = { ...options, projects: [project] };
    render();
    await finish();
    expect(options.onProjectAdded).toHaveBeenCalledExactlyOnceWith(project);
  });
  it("rejects manual navigation A B A while open is pending", async () => {
    start();
    const original = options.selectionIdentity;
    options = { ...options, selectionIdentity: {} };
    render();
    options = { ...options, selectionIdentity: original, projects: [project] };
    render();
    await finish();
    expect(options.onProjectAdded).not.toHaveBeenCalled();
  });
  it("rejects completion after closing or reopening the dialog", async () => {
    start();
    act(() => current.closeDialog());
    act(() => current.openDialog());
    options = { ...options, projects: [project] };
    render();
    await finish();
    expect(options.onProjectAdded).not.toHaveBeenCalled();
  });
  it("rejects results and notices after unmount", async () => {
    start();
    act(() => root.render(null));
    await finish();
    expect(options.onProjectAdded).not.toHaveBeenCalled();
    expect(options.reportNotice).not.toHaveBeenCalled();
  });
  it("does not report a superseded failure", async () => {
    start();
    options = { ...options, selectionIdentity: {} };
    render();
    await act(async () => reject(new Error("late")));
    expect(options.reportNotice).not.toHaveBeenCalled();
  });
});
