// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPendingSendSelection, AgentPendingSendTarget } from "./agentPendingSend";
import { NO_AGENT_STARTING_THREADS, agentStartingThreadKey } from "./agentStartingThreads";
import { useAgentPendingSends, type AgentPendingSendsCoordinator } from "./useAgentPendingSends";

const APP_DRAFT: AgentPendingSendSelection = { kind: "new", projectRootKey: "/app" };
const API_DRAFT: AgentPendingSendSelection = { kind: "new", projectRootKey: "/api" };
const APP_TARGET: AgentPendingSendTarget = {
  kind: "new",
  projectRootKey: "/app",
  provider: "claudeCode",
};
const API_TARGET: AgentPendingSendTarget = {
  kind: "new",
  projectRootKey: "/api",
  provider: "codex",
};
const FOLLOW_UP_TARGET: AgentPendingSendTarget = {
  kind: "followUp",
  threadId: "agt-7",
  baseTurnId: "t1",
};
const NOW = () => 42;
const APP_OWNER = { ownerId: "agent-root:app", generation: 2 } as const;

describe("useAgentPendingSends starting threads", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentPendingSendsCoordinator | null;
  let renders: number;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    renders = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function Harness({ selection }: { readonly selection: AgentPendingSendSelection | null }) {
    captured = useAgentPendingSends(selection, NOW);
    renders += 1;
    return null;
  }

  function render(selection: AgentPendingSendSelection | null): void {
    act(() => root.render(<Harness selection={selection} />));
  }

  function current(): AgentPendingSendsCoordinator {
    expect(captured).not.toBeNull();
    return captured as AgentPendingSendsCoordinator;
  }

  function begin(target: AgentPendingSendTarget, prompt: string): number {
    let id = 0;
    act(() => {
      id = current().begin(target, prompt, [], target === APP_TARGET ? APP_OWNER : null);
    });
    return id;
  }

  it("starts with the shared empty list", () => {
    render(APP_DRAFT);

    expect(current().starting).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("lists a new send as starting and current on its own draft", () => {
    render(APP_DRAFT);
    const id = begin(APP_TARGET, "Add a health check");

    expect(current().starting).toEqual([
      {
        key: agentStartingThreadKey(id),
        projectRootKey: "/app",
        owner: APP_OWNER,
        provider: "claudeCode",
        threadId: null,
        title: "Add a health check",
        sentAtEpochMs: 42,
        current: true,
      },
    ]);
  });

  it("keeps the starting thread but not its current mark when the view moves elsewhere", () => {
    render(APP_DRAFT);
    const id = begin(APP_TARGET, "Add a health check");

    render({ kind: "thread", threadId: "agt-7", lastTurnId: "t1" });

    expect(current().visible).toBeNull();
    expect(current().starting).toEqual([
      expect.objectContaining({ key: agentStartingThreadKey(id), current: false }),
    ]);

    render(API_DRAFT);

    expect(current().starting).toEqual([
      expect.objectContaining({ key: agentStartingThreadKey(id), current: false }),
    ]);
  });

  it("keeps one list reference across unrelated renders and follow-up sends", () => {
    render(APP_DRAFT);
    begin(APP_TARGET, "Add a health check");
    const starting = current().starting;

    render({ ...APP_DRAFT });
    expect(current().starting).toBe(starting);

    const followUp = begin(FOLLOW_UP_TARGET, "And a test");
    expect(current().starting).toBe(starting);

    act(() => current().settle(followUp, "sent"));
    expect(current().starting).toBe(starting);
  });

  it("records the thread id on exactly the identified send and leaves the visible send alone", () => {
    render(APP_DRAFT);
    const app = begin(APP_TARGET, "Add a health check");
    const api = begin(API_TARGET, "Document the endpoints");
    const before = current().starting;

    act(() => current().markIdentified(app, "agt-1"));

    expect(current().starting.map((entry) => [entry.key, entry.threadId])).toEqual([
      [agentStartingThreadKey(app), "agt-1"],
      [agentStartingThreadKey(api), null],
    ]);
    expect(current().starting[1]).toBe(before[1]);
    expect(current().visible).toEqual(
      expect.objectContaining({ id: app, status: "sending", prompt: "Add a health check" }),
    );
  });

  it("ignores an identification for a send that already settled", () => {
    render(APP_DRAFT);
    const app = begin(APP_TARGET, "Add a health check");
    const api = begin(API_TARGET, "Document the endpoints");
    act(() => current().settle(app, "failed"));
    const starting = current().starting;
    const visible = current().visible;

    act(() => current().markIdentified(app, "agt-1"));

    expect(current().starting).toBe(starting);
    expect(current().visible).toBe(visible);
    expect(starting.map((entry) => entry.key)).toEqual([agentStartingThreadKey(api)]);
  });

  it.each(["sent", "failed", "withdrawn"] as const)(
    "shows no starting thread after the send settles as %s",
    (outcome) => {
      render(APP_DRAFT);
      const id = begin(APP_TARGET, "Add a health check");

      act(() => current().settle(id, outcome));

      expect(current().starting).toBe(NO_AGENT_STARTING_THREADS);
    },
  );

  it("does nothing when an identification arrives after unmount", () => {
    const consoleError = vi.spyOn(console, "error");
    render(APP_DRAFT);
    const id = begin(APP_TARGET, "Add a health check");
    const coordinator = current();
    const rendersBefore = renders;

    act(() => root.unmount());
    root = createRoot(host);
    expect(() => coordinator.markIdentified(id, "agt-1")).not.toThrow();

    expect(renders).toBe(rendersBefore);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
