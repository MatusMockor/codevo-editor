// @vitest-environment jsdom
import { act, useReducer, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionTaskStopResult,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const THREAD_ID = "agt-1";
const STOP_LABEL = 'Stop background task "Watch beta.75 release workflow"';

const interruptedTurn: AgentTurn = {
  turnId: "turn-interrupted",
  prompt: "Watch the beta.75 release workflow",
  status: { kind: "exited", exitCode: 130 },
  startedAtEpochMs: 1_700_000_000_000,
  endedAtEpochMs: 1_700_000_001_000,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 0,
  streamMetrics: null,
  launch: null,
  cliVersion: null,
};

const watch: AgentSessionBackground = {
  ownerId: "agent-root:app",
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1_700_000_001_000,
};

function idleView(sessionBackground: AgentSessionBackground | undefined): AgentThreadView {
  return surfaceThreadView({
    lifecycle: "settled",
    ...(sessionBackground === undefined ? {} : { sessionBackground }),
    thread: { ...surfaceThreadView().thread, threadId: THREAD_ID, turns: [interruptedTurn] },
  });
}

describe("stopping a native background task left live in an idle Claude session", () => {
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
  });

  async function mount(options: { endable?: boolean } = {}) {
    const endable = options.endable ?? true;
    const shown = idleView(watch);
    const stop = vi.fn(async (_threadId: string) => undefined);
    const stopSessionBackgroundTask = vi.fn(
      async (_threadId: string, _taskId: string): Promise<AgentSessionTaskStopResult> => ({
        kind: "stopping",
      }),
    );
    const endSession = vi.fn(async (_threadId: string) => "ended" as const);
    const inspectSessionBackground = vi.fn(async (_threadId: string) => "live" as const);
    let setThreads: ((next: ReadonlyArray<AgentThreadView>) => void) | null = null;
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: THREAD_ID,
        selectedThreadOwnerKey: idleView(watch).thread.owner.ownerId,
        scopeState: NO_SCOPE_STATE,
      },
    };

    function Harness() {
      const [threads, replaceThreads] = useState<ReadonlyArray<AgentThreadView>>([shown]);
      setThreads = replaceThreads;
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      const agents: AgentThreadsSurface = threadsSurfaceFixture({
        threads,
        stop,
        stopSessionBackgroundTask,
        ...(endable ? { endSession } : {}),
        inspectSessionBackground,
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
    return {
      stop,
      stopSessionBackgroundTask,
      endSession,
      setThreads(next: ReadonlyArray<AgentThreadView>) {
        expect(setThreads).not.toBeNull();
        act(() => setThreads?.(next));
      },
    };
  }

  function labelled(label: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === label,
      ) ?? null
    );
  }

  function named(name: string): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent === name,
    );
  }

  function escape(target: EventTarget): void {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  }

  it("stops the task from the dock, shows it stopping and clears once the level drops it", async () => {
    const harness = await mount();
    const bar = host.querySelector(".cv-session-dock__banners");
    expect(bar?.textContent).toContain("1 background task running");
    expect(bar?.textContent).toContain("Watch beta.75 release workflow");

    const stop = labelled(STOP_LABEL);
    expect(stop).not.toBeNull();
    await act(async () => stop?.click());

    expect(harness.stopSessionBackgroundTask).toHaveBeenCalledExactlyOnceWith(
      THREAD_ID,
      "b8kzpiexm",
    );
    expect(harness.stop).not.toHaveBeenCalled();
    expect(labelled(STOP_LABEL)?.textContent).toBe("Stopping…");
    expect(labelled(STOP_LABEL)?.disabled).toBe(true);

    harness.setThreads([idleView(undefined)]);
    expect(labelled(STOP_LABEL)).toBeNull();
    expect(host.querySelector(".cv-session-dock__banners .cv-composer-banner")).toBeNull();
  });

  it("confirms on Esc for the idle thread and stops its tasks on a second Esc", async () => {
    const harness = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;
    act(() => transcript.focus());

    escape(transcript);
    expect(host.textContent).toContain(
      "1 background task is still running in Claude's session. Press Stop tasks or Esc again to stop it.",
    );
    expect(named("Stop tasks")).toHaveLength(1);
    expect(harness.stopSessionBackgroundTask).not.toHaveBeenCalled();

    escape(transcript);
    await act(async () => undefined);
    expect(harness.stopSessionBackgroundTask).toHaveBeenCalledExactlyOnceWith(
      THREAD_ID,
      "b8kzpiexm",
    );
    expect(harness.stop).not.toHaveBeenCalled();
    expect(named("Stop tasks")).toHaveLength(0);
  });

  it("names Claude's refusal, emphasises End session and lists the task in its confirmation", async () => {
    const harness = await mount();
    harness.stopSessionBackgroundTask.mockResolvedValueOnce({
      kind: "refused",
      reason: "No task found with ID: b8kzpiexm",
    });

    await act(async () => labelled(STOP_LABEL)?.click());

    expect(host.textContent).toContain(
      'Claude could not stop "Watch beta.75 release workflow": No task found with ID: b8kzpiexm. You can end Claude\'s session instead.',
    );
    expect(labelled(STOP_LABEL)?.disabled).toBe(false);
    const end = labelled("End Claude session");
    expect(end?.className).toContain("cv-banner-action--emphasis");

    await act(async () => end?.click());
    await waitForReact(() =>
      expect(host.textContent).toContain(
        'If a task keeps running after the session ends, stop it yourself: "Watch beta.75 release workflow".',
      ),
    );
    expect(host.textContent).toContain(
      "Ending the session may stop background tasks Claude started.",
    );
    const confirm = named("End session").find(
      (button) => button.getAttribute("aria-label") === null,
    );
    await act(async () => confirm?.click());
    expect(harness.endSession).toHaveBeenCalledExactlyOnceWith(THREAD_ID);
  });

  it("offers no End session in the idle Esc confirmation without an End session port", async () => {
    await mount({ endable: false });
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll");
    expect(transcript).not.toBeNull();
    if (transcript === null) return;
    act(() => transcript.focus());

    escape(transcript);

    expect(named("Stop tasks")).toHaveLength(1);
    expect(named("End session")).toHaveLength(0);
    expect(labelled("End Claude session")).toBeNull();
  });
});
