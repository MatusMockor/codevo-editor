// @vitest-environment jsdom

import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "../../application/agentViewCommandBridge";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const ROOT = "/workspace/app";
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const CHROME = chromeFixture();
const PROJECTS = [
  projectFixture({
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: `agent-root:${ROOT}`,
    label: "app",
    repositories: [fixtureRepository(ROOT, "")],
  }),
];
const REPOSITORIES = [fixtureRepository(ROOT, "")];

function memoryStorage(entries: Record<string, string>): KeyValueStorage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function idle(threadId: string, pinned = false): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: "app",
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      pinned,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey: ROOT, ownerId: `agent-root:${ROOT}`, repositoryRoot: ROOT },
    },
  });
}

function working(threadId: string, pinned = false): AgentThreadView {
  const view = idle(threadId, pinned);
  return {
    ...view,
    sessionBackground: {
      ownerId: view.thread.owner.ownerId,
      total: 1,
      agents: 0,
      tasks: [{ taskId: `shell-${threadId}`, taskType: "shell" }],
      sinceEpochMs: 3_000,
      taskSinceEpochMs: new Map(),
    },
  };
}

function withTogglePin(
  views: ReadonlyArray<AgentThreadView>,
  threadId: string,
): ReadonlyArray<AgentThreadView> {
  return views.map((view) =>
    view.thread.threadId === threadId
      ? { ...view, thread: { ...view.thread, pinned: !view.thread.pinned } }
      : view,
  );
}

describe("AgentModeView Working section", () => {
  let host: HTMLDivElement;
  let root: Root;
  let bridge: AgentViewCommandBridge;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  function Harness({
    initial,
    preference,
  }: {
    readonly initial: ReadonlyArray<AgentThreadView>;
    readonly preference: AgentRailWorkingSectionPreferencePort | null;
  }) {
    const [threads, setThreads] = useState(initial);
    const agents = useMemo(
      () => ({
        ...threadsSurfaceFixture({
          threads,
          repositories: REPOSITORIES,
          togglePin: (threadId) => setThreads((current) => withTogglePin(current, threadId)),
        }),
        providerManagement: PROVIDER_MANAGEMENT,
      }),
      [threads],
    );
    return (
      <AgentModeView
        agents={agents}
        chrome={CHROME}
        onReleaseProject={() => undefined}
        onTrustProject={() => undefined}
        overflowRootPaths={[]}
        projects={PROJECTS}
        providerEnabled={{ claudeCode: true, codex: true }}
        viewCommands={bridge}
        workingSectionPreference={preference}
        workspaceRoot={ROOT}
      />
    );
  }

  function workingOn(): AgentRailWorkingSectionPreferencePort {
    return new BrowserAgentRailWorkingSectionPreference(
      memoryStorage({ [AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]: "on" }),
    );
  }

  function mount(
    initial: ReadonlyArray<AgentThreadView>,
    preference: AgentRailWorkingSectionPreferencePort | null,
  ): void {
    act(() => root.render(<Harness initial={initial} preference={preference} />));
  }

  function row(threadId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${threadId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function railRowIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>(".agent-rail [data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function selectedRowId(): string | null {
    return (
      host.querySelector<HTMLElement>('.agent-rail [data-thread-id][aria-current="true"]')?.dataset
        .threadId ?? null
    );
  }

  function workingShelf(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('.cv-sb-shelf[data-shelf="working"]');
  }

  function pinnedRowIds(): ReadonlyArray<string> {
    return [
      ...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-pinned [data-thread-id]"),
    ].map((element) => element.dataset.threadId ?? "");
  }

  function press(target: HTMLElement, key: string): void {
    target.focus();
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    bridge = createAgentViewCommandBridge();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("keeps the rail as it is today without the preference", () => {
    mount([idle("agt-a"), working("agt-b"), idle("agt-c")], null);

    expect(workingShelf()).toBeNull();
    expect(railRowIds()).toEqual(["agt-a", "agt-b", "agt-c"]);

    act(() => bridge.run("agent.jumpToThread.2"));
    expect(selectedRowId()).toBe("agt-b");
    act(() => bridge.run("agent.nextThread"));
    expect(selectedRowId()).toBe("agt-c");
  });

  it("jumps and steps through exactly the rows the rail shows", () => {
    mount([idle("agt-a"), working("agt-b"), idle("agt-c")], workingOn());
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(railRowIds()).toEqual(["agt-a", "agt-c"]);

    act(() => bridge.run("agent.jumpToThread.2"));
    expect(selectedRowId()).toBe("agt-c");
    act(() => bridge.run("agent.jumpToThread.3"));
    expect(selectedRowId()).toBe("agt-c");

    act(() => workingShelf()?.click());
    expect(railRowIds()).toEqual(["agt-a", "agt-c", "agt-b"]);
    act(() => bridge.run("agent.jumpToThread.3"));
    expect(selectedRowId()).toBe("agt-b");

    act(() => workingShelf()?.click());
    expect(workingShelf()?.getAttribute("aria-expanded")).toBe("false");
    expect(railRowIds()).toEqual(["agt-a", "agt-c", "agt-b"]);
    act(() => bridge.run("agent.previousThread"));
    expect(selectedRowId()).toBe("agt-c");
    expect(railRowIds()).toEqual(["agt-a", "agt-c"]);
    act(() => bridge.run("agent.nextThread"));
    expect(selectedRowId()).toBe("agt-a");
  });

  it("pins a thread straight out of the Working shelf", () => {
    mount([working("agt-a"), idle("agt-b")], workingOn());
    expect(railRowIds()).toEqual(["agt-b"]);
    act(() => workingShelf()?.click());
    expect(railRowIds()).toEqual(["agt-b", "agt-a"]);

    act(() => row("agt-a").click());
    press(row("agt-a"), "p");

    expect(pinnedRowIds()).toEqual(["agt-a"]);
    expect(workingShelf()).toBeNull();
    expect(railRowIds()).toEqual(["agt-a", "agt-b"]);
  });

  it("drops an unpinned working thread into the Working shelf and keeps it visible while selected", () => {
    mount([working("agt-a", true), idle("agt-b")], workingOn());
    expect(workingShelf()).toBeNull();
    expect(pinnedRowIds()).toEqual(["agt-a"]);

    act(() => row("agt-a").click());
    press(row("agt-a"), "p");

    expect(pinnedRowIds()).toEqual([]);
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(workingShelf()?.getAttribute("aria-expanded")).toBe("false");
    expect(railRowIds()).toEqual(["agt-b", "agt-a"]);
    expect(selectedRowId()).toBe("agt-a");
  });
});
