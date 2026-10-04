// @vitest-environment jsdom

import { act, useMemo, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentThreads, type AgentThreadsHookSurface } from "../../application/useAgentThreads";
import type { AgentThread } from "../../domain/agentThread";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  UNDO_FIXTURE_PROJECTS,
  UNDO_FIXTURE_ROOT,
  undoStoredThread,
  undoThreadDependencies,
  undoThreadGateways,
  type UndoThreadGateways,
} from "../../test/agentThreadUndoFixtures";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();

function workingOnStorage(): KeyValueStorage {
  const values = new Map([[AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on"]]);
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

function workingInBackground(view: AgentThreadView): AgentThreadView {
  return {
    ...view,
    sessionBackground: {
      ownerId: view.thread.owner.ownerId,
      total: 1,
      agents: 0,
      tasks: [{ taskId: `shell-${view.thread.threadId}`, taskType: "shell" }],
      sinceEpochMs: 3_000,
      taskSinceEpochMs: new Map(),
    },
  };
}

describe("AgentModeView thread action undo with the Working section", () => {
  let host: HTMLDivElement;
  let root: Root;
  let agents: AgentThreadsHookSurface | null;
  let gateways: UndoThreadGateways;
  const preference = new BrowserAgentRailWorkingSectionPreference(workingOnStorage());
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  function Harness({ workingThreadIds }: { readonly workingThreadIds: ReadonlySet<string> }) {
    const [layout, dispatch] = useReducer(agentWorkbenchLayoutReducer, initialAgentWorkbenchLayout);
    const surface = useAgentThreads(undoThreadDependencies(gateways));
    const threads = useMemo(
      () =>
        surface.threads.map((view) =>
          workingThreadIds.has(view.thread.threadId) ? workingInBackground(view) : view,
        ),
      [surface.threads, workingThreadIds],
    );
    agents = surface;
    return (
      <AgentModeView
        agents={{ ...surface, threads, providerManagement: PROVIDER_MANAGEMENT }}
        chrome={chromeFixture({
          layout: { layout, effectiveLayout: "agent", persistedBottomPanel: false, dispatch },
        })}
        onReleaseProject={() => undefined}
        onTrustProject={() => undefined}
        overflowRootPaths={[]}
        projects={UNDO_FIXTURE_PROJECTS}
        providerEnabled={{ claudeCode: true, codex: true }}
        workingSectionPreference={preference}
        workspaceRoot={UNDO_FIXTURE_ROOT}
      />
    );
  }

  async function mount(
    storedThreads: ReadonlyArray<AgentThread>,
    working: ReadonlyArray<string>,
  ): Promise<void> {
    gateways = undoThreadGateways(storedThreads);
    const workingThreadIds = new Set(working);
    await act(async () => root.render(<Harness workingThreadIds={workingThreadIds} />));
    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-rail [data-thread-id]").length).toBe(
        storedThreads.length,
      ),
    );
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

  function workingShelf(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('.cv-sb-shelf[data-shelf="working"]');
  }

  function pinned(threadId: string): boolean | undefined {
    return agents?.threads.find((view) => view.thread.threadId === threadId)?.thread.pinned;
  }

  function noticeText(): string | null {
    const region = host.querySelector('.agent-mode__center [data-slot="agent-thread-undo"]');
    expect(region).not.toBeNull();
    return region?.querySelector(".agent-notice > span")?.textContent ?? null;
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    agents = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("offers undo when a working thread is unpinned into the Working shelf", async () => {
    await mount(
      [undoStoredThread("agt-a", { pinned: true }), undoStoredThread("agt-b")],
      ["agt-a"],
    );
    expect(workingShelf()).toBeNull();
    expect(noticeText()).toBeNull();

    await act(async () => row("agt-a").click());
    row("agt-a").focus();
    act(() => {
      row("agt-a").dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true }),
      );
    });

    expect(pinned("agt-a")).toBe(false);
    expect(workingShelf()?.textContent).toContain("Working (1)");
    expect(railRowIds()).toEqual(["agt-b", "agt-a"]);
    expect(noticeText()).toBe("Thread unpinned");

    const undo = [...host.querySelectorAll<HTMLButtonElement>(".agent-notice button")].find(
      (button) => button.textContent === "Undo",
    );
    expect(undo).toBeDefined();
    await act(async () => undo?.click());

    expect(pinned("agt-a")).toBe(true);
    expect(workingShelf()).toBeNull();
    expect(railRowIds()).toEqual(["agt-a", "agt-b"]);
    expect(noticeText()).toBeNull();
  });
});
