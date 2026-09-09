// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";
import type { AgentProjectWorkspaceActivation } from "./useAgentProjectWorkspaceSync";
import { useAgentWorkspaceNavigationBoundary } from "./useAgentWorkspaceNavigationBoundary";

const a = { ...projectFixture(), rootKey: "/a", rootPath: "/a", label: "a" };
const b = { ...projectFixture(), rootKey: "/b", rootPath: "/b", label: "b" };

describe("workspace navigation precedence", () => {
  let root: ReturnType<typeof createRoot>;
  let workspaceRoot: string;
  let projects: readonly (typeof a)[];
  let activation: AgentProjectWorkspaceActivation;
  let adding: string | null;
  let result: ReturnType<typeof useAgentWorkspaceNavigationBoundary>;
  const session: AgentNavigationSession = {
    current: {
      selectedThreadId: "thread-b",
      selectedThreadOwnerKey: "owner",
      scopeState: NO_SCOPE_STATE,
    },
  };
  function Harness() {
    result = useAgentWorkspaceNavigationBoundary(
      workspaceRoot,
      projects,
      activation,
      adding,
      session,
    );
    return null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    workspaceRoot = "/a";
    projects = [a, b];
    activation = { kind: "ready", rootPath: "/a" };
    adding = null;
    session.current = {
      selectedThreadId: "thread-b",
      selectedThreadOwnerKey: "owner",
      scopeState: NO_SCOPE_STATE,
    };
    render();
  });
  afterEach(() => act(() => root.unmount()));

  it("preserves navigation when the selected project's internal activation commits", () => {
    activation = { kind: "pending", rootPath: "/b" };
    render();
    workspaceRoot = "/b";
    render();
    expect(session.current.selectedThreadId).toBe("thread-b");
  });

  it("clears thread selection and selects the externally activated editor project", () => {
    workspaceRoot = "/b";
    render();
    expect(session.current.selectedThreadId).toBeNull();
    expect(session.current.scopeState.railScope?.projectRootKey).toBe("/b");
  });

  it("lets an external project win over a different pending internal activation", () => {
    const c = { ...a, rootKey: "/c", rootPath: "/c" };
    projects = [a, b, c];
    activation = { kind: "pending", rootPath: "/b" };
    render();
    workspaceRoot = "/c";
    render();
    expect(session.current.selectedThreadId).toBeNull();
    expect(session.current.scopeState.railScope?.projectRootKey).toBe("/c");
  });

  it("lets an external editor project override an unrelated pending add", () => {
    adding = "/c";
    workspaceRoot = "/b";
    render();
    expect(result.cancelPendingAdd).toBe(true);
    expect(session.current.selectedThreadId).toBeNull();
    expect(session.current.scopeState.railScope?.projectRootKey).toBe("/b");
  });

  it("does not revive an old thread on external A to B to A navigation", () => {
    workspaceRoot = "/b";
    render();
    activation = { kind: "ready", rootPath: "/b" };
    render();
    workspaceRoot = "/a";
    render();
    expect(session.current.selectedThreadId).toBeNull();
    expect(session.current.scopeState.railScope?.projectRootKey).toBe("/a");
  });

  it("waits for the external project's descriptor rather than falling back to the old project", () => {
    projects = [a];
    workspaceRoot = "/b";
    render();
    expect(result.pendingExternalRoot).toBe("/b");
    const waitingKey = result.key;
    projects = [a, b];
    render();
    expect(result.pendingExternalRoot).toBeNull();
    expect(result.key).not.toBe(waitingKey);
    expect(session.current.scopeState.railScope?.projectRootKey).toBe("/b");
  });
});
