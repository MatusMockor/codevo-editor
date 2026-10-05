// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AGENT_END_SESSION_STOP_TEXT } from "./AgentEndSessionConfirmationBanner";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const THREAD_ID = "agt-1";
const OTHER_THREAD_ID = "agt-2";
const STOP_CONFIRMATION_TEXT =
  "1 background task is still running in Claude's session. Press Stop tasks or Esc again to stop it.";

const watch: AgentSessionBackground = {
  ownerId: "agent-root:app",
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1_700_000_001_000,
  taskSinceEpochMs: new Map([["b8kzpiexm", 1_700_000_001_000]]),
};

function selectedView(): AgentThreadView {
  return surfaceThreadView({
    lifecycle: "settled",
    sessionBackground: watch,
    thread: { ...surfaceThreadView().thread, threadId: THREAD_ID },
  });
}

function otherView(): AgentThreadView {
  return surfaceThreadView({
    lifecycle: "settled",
    thread: { ...surfaceThreadView().thread, threadId: OTHER_THREAD_ID, title: "Nightly build" },
  });
}

describe("where the End Claude session confirmation is rendered", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
  });

  async function mount() {
    const threads = [selectedView(), otherView()];
    const endSession = vi.fn(async (_threadId: string) => "ended" as const);
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: THREAD_ID,
        selectedThreadOwnerKey: threads[0]!.thread.owner.ownerId,
        scopeState: NO_SCOPE_STATE,
      },
    };

    function Harness() {
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      const agents: AgentThreadsSurface = threadsSurfaceFixture({
        threads,
        stop: async () => undefined,
        stopSessionBackgroundTask: async () => ({ kind: "stopping" }),
        endSession,
        inspectSessionBackground: async () => "live" as const,
      });
      return (
        <AgentModeView
          agents={{ ...agents, providerManagement: unconfiguredAgentProviderManagement() }}
          chrome={chromeFixture({
            layout: {
              layout,
              effectiveLayout: "agent",
              persistedBottomPanel: false,
              dispatch,
            },
          })}
          navigationSession={session}
          onOpenEnvironmentSettings={() => undefined}
          onReleaseProject={() => undefined}
          onTrustProject={() => undefined}
          overflowRootPaths={[]}
          projects={[projectFixture()]}
          providerEnabled={{ claudeCode: true, codex: true }}
          workspaceRoot={SURFACE_FIXTURE_ROOT}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    if (host.querySelector(".agent-session__scroll") === null) {
      const row = host.querySelector<HTMLElement>(`[data-thread-id="${THREAD_ID}"]`);
      await act(async () => row?.click());
    }
    await waitForReact(() => expect(host.querySelector(".agent-session__scroll")).not.toBeNull());
    return { endSession };
  }

  function labelled(label: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === label,
      ) ?? null
    );
  }

  function bannersContaining(text: string): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(".cv-composer-banner")].filter((banner) =>
      (banner.textContent ?? "").includes(text),
    );
  }

  function actionIn(banner: HTMLElement | undefined, name: string): HTMLButtonElement | null {
    return (
      [...(banner?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (button) => button.textContent === name,
      ) ?? null
    );
  }

  async function requestFromDock(): Promise<void> {
    const end = labelled("End Claude session");
    expect(end).not.toBeNull();
    await act(async () => end?.click());
    await waitForReact(() =>
      expect(bannersContaining(AGENT_END_SESSION_STOP_TEXT)).toHaveLength(1),
    );
  }

  async function requestFromRowMenu(threadId: string): Promise<void> {
    const row = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }),
      );
    });
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "End Claude session",
    );
    expect(item).toBeDefined();
    await act(async () => item?.click());
    await waitForReact(() =>
      expect(bannersContaining(AGENT_END_SESSION_STOP_TEXT)).toHaveLength(1),
    );
  }

  function expectHostedByComposer(banner: HTMLElement | undefined): void {
    const frame = host.querySelector<HTMLElement>(".agent-mode__center .cv-composer");
    const stack = frame?.querySelector<HTMLElement>(".cv-composer__banners");
    expect(frame).not.toBeNull();
    expect(stack).not.toBeNull();
    expect(banner).toBeDefined();
    expect(banner?.parentElement).toBe(stack);
    expect(banner?.closest(".cv-composer")).toBe(frame);
    expect(banner?.parentElement?.classList.contains("agent-mode__center")).toBe(false);
  }

  it("tucks the confirmation requested from the session dock into the composer's banner stack", async () => {
    await mount();

    await requestFromDock();

    const [banner] = bannersContaining(AGENT_END_SESSION_STOP_TEXT);
    expect(banner?.textContent).toContain('End Claude\'s session for "Refactor the parser"?');
    expectHostedByComposer(banner);
  });

  it("keeps another thread's confirmation in the visible composer's banner stack", async () => {
    const harness = await mount();

    await requestFromRowMenu(OTHER_THREAD_ID);

    const [banner] = bannersContaining(AGENT_END_SESSION_STOP_TEXT);
    expect(banner?.textContent).toContain('End Claude\'s session for "Nightly build"?');
    expectHostedByComposer(banner);
    await act(async () => actionIn(banner, "End session")?.click());
    expect(harness.endSession).toHaveBeenCalledExactlyOnceWith(OTHER_THREAD_ID);
    expect(bannersContaining(AGENT_END_SESSION_STOP_TEXT)).toHaveLength(0);
  });

  it("stacks beside the stop confirmation as a sibling tab instead of nesting or leaving the stack", async () => {
    await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(transcript).not.toBeNull();
    act(() => {
      transcript?.focus();
      transcript?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(bannersContaining(STOP_CONFIRMATION_TEXT)).toHaveLength(1);

    await requestFromRowMenu(OTHER_THREAD_ID);

    const stack = host.querySelector<HTMLElement>(".agent-mode__center .cv-composer__banners");
    const [stop] = bannersContaining(STOP_CONFIRMATION_TEXT);
    const [end] = bannersContaining(AGENT_END_SESSION_STOP_TEXT);
    expectHostedByComposer(end);
    expect(stop?.parentElement).toBe(stack);
    expect(stack?.querySelector(".cv-composer-banner .cv-composer-banner")).toBeNull();
    expect([...(stack?.children ?? [])].indexOf(end!)).toBe(
      [...(stack?.children ?? [])].indexOf(stop!) + 1,
    );
  });

  it("returns focus to the prompt once the confirmation is answered", async () => {
    const harness = await mount();
    await requestFromDock();
    const [banner] = bannersContaining(AGENT_END_SESSION_STOP_TEXT);
    const keep = actionIn(banner, "Keep running");
    expect(keep).not.toBeNull();
    act(() => keep?.focus());

    await act(async () => keep?.click());

    expect(bannersContaining(AGENT_END_SESSION_STOP_TEXT)).toHaveLength(0);
    expect(harness.endSession).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector("#agent-prompt"));
  });
});
