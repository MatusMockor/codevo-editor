// @vitest-environment jsdom

import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentThreads, type AgentThreadsHookSurface } from "../../application/useAgentThreads";
import type { AgentThread } from "../../domain/agentThread";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { detectKeymapPlatform } from "../../domain/keymap";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import {
  UNDO_FIXTURE_PROJECTS,
  UNDO_FIXTURE_ROOT,
  undoStoredThread,
  undoThreadDependencies,
  undoThreadGateways,
  type UndoThreadGateways,
} from "../../test/agentThreadUndoFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();

describe("AgentModeView thread action undo", () => {
  let host: HTMLDivElement;
  let root: Root;
  let agents: AgentThreadsHookSurface | null;
  let gateways: UndoThreadGateways;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  function Harness() {
    const [layout, dispatch] = useReducer(agentWorkbenchLayoutReducer, initialAgentWorkbenchLayout);
    const surface = useAgentThreads(undoThreadDependencies(gateways));
    agents = surface;
    return (
      <AgentModeView
        agents={{ ...surface, providerManagement: PROVIDER_MANAGEMENT }}
        chrome={chromeFixture({
          layout: { layout, effectiveLayout: "agent", persistedBottomPanel: false, dispatch },
        })}
        onReleaseProject={() => undefined}
        onTrustProject={() => undefined}
        overflowRootPaths={[]}
        projects={UNDO_FIXTURE_PROJECTS}
        providerEnabled={{ claudeCode: true, codex: true }}
        workspaceRoot={UNDO_FIXTURE_ROOT}
      />
    );
  }

  async function mount(storedThreads: ReadonlyArray<AgentThread>): Promise<void> {
    gateways = undoThreadGateways(storedThreads);
    await act(async () => root.render(<Harness />));
    await waitForReact(() =>
      expect(host.querySelectorAll("[data-thread-id]").length).toBe(storedThreads.length),
    );
  }

  function row(threadId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function pinned(threadId: string): boolean | undefined {
    return agents?.threads.find((view) => view.thread.threadId === threadId)?.thread.pinned;
  }

  function noticeText(): string | null {
    const region = host.querySelector('.agent-mode__center [data-slot="agent-thread-undo"]');
    expect(region).not.toBeNull();
    return region?.querySelector(".agent-notice > span")?.textContent ?? null;
  }

  function press(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.focus();
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function undoChord(): KeyboardEventInit {
    if (detectKeymapPlatform() === "mac") return { key: "z", metaKey: true };
    return { key: "z", ctrlKey: true };
  }

  async function unpinFromRail(threadId: string): Promise<void> {
    await act(async () => row(threadId).click());
    press(row(threadId), { key: "p" });
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

  it("offers undo for a rail unpin and restores it from the Undo button", async () => {
    await mount([undoStoredThread("agt-a", { pinned: true }), undoStoredThread("agt-b")]);
    expect(noticeText()).toBeNull();

    await unpinFromRail("agt-a");
    expect(pinned("agt-a")).toBe(false);
    expect(noticeText()).toBe("Thread unpinned");

    const undo = [...host.querySelectorAll<HTMLButtonElement>(".agent-notice button")].find(
      (button) => button.textContent === "Undo",
    );
    expect(undo).toBeDefined();
    await act(async () => undo?.click());
    expect(pinned("agt-a")).toBe(true);
    expect(noticeText()).toBeNull();
  });

  it("undoes with the keyboard from the thread rail but never from the composer", async () => {
    await mount([undoStoredThread("agt-a", { pinned: true }), undoStoredThread("agt-b")]);
    await unpinFromRail("agt-a");
    expect(noticeText()).toBe("Thread unpinned");

    const composer = host.querySelector<HTMLElement>(
      ".agent-mode__center textarea, .agent-mode__center [contenteditable]",
    );
    expect(composer).not.toBeNull();
    const typed = press(composer as HTMLElement, undoChord());
    expect(typed.defaultPrevented).toBe(false);
    expect(pinned("agt-a")).toBe(false);
    expect(noticeText()).toBe("Thread unpinned");

    const fromRail = press(row("agt-a"), undoChord());
    await act(async () => Promise.resolve());
    expect(fromRail.defaultPrevented).toBe(true);
    expect(pinned("agt-a")).toBe(true);
    expect(noticeText()).toBeNull();
  });

  it("offers no undo when the rail shortcut pins a thread", async () => {
    await mount([undoStoredThread("agt-a"), undoStoredThread("agt-b")]);
    await act(async () => row("agt-a").click());
    press(row("agt-a"), { key: "p" });
    expect(pinned("agt-a")).toBe(true);
    expect(noticeText()).toBeNull();
    expect(press(row("agt-a"), undoChord()).defaultPrevented).toBe(false);
  });
});
