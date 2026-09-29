// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
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

function runningTurn(): AgentTurn {
  return {
    turnId: "turn-running",
    prompt: "Refactor the parser",
    status: { kind: "running" },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
  };
}

function settledTurn(): AgentTurn {
  return {
    ...runningTurn(),
    status: { kind: "exited", exitCode: 0 },
    endedAtEpochMs: 1_700_000_001_000,
  };
}

describe("Escape stops the running agent from anywhere in its conversation", () => {
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

  async function mount(turn: AgentTurn = runningTurn()) {
    const stop = vi.fn(async (_threadId: string) => undefined);
    const view = surfaceThreadView({
      lifecycle: turn.status.kind === "running" ? "running" : "settled",
      thread: { ...surfaceThreadView().thread, threadId: THREAD_ID, turns: [turn] },
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({ threads: [view], stop });
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: THREAD_ID,
        selectedThreadOwnerKey: view.thread.owner.ownerId,
        scopeState: NO_SCOPE_STATE,
      },
    };

    function Harness() {
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
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
    return { stop };
  }

  function center(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-mode__center");
    expect(element).not.toBeNull();
    return element!;
  }

  function pointerDown(target: Element): void {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
  }

  function escape(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("stops when focus is in the transcript instead of the composer", async () => {
    const { stop } = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;
    act(() => transcript.focus());

    const event = escape(transcript);

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops after a click in the conversation left focus on the body, as WebKit does", async () => {
    const { stop } = await mount();
    pointerDown(host.querySelector(".agent-session__scroll")!);
    (document.activeElement as HTMLElement | null)?.blur();

    escape(document.body);

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID);
  });

  it("stops from the thread header", async () => {
    const { stop } = await mount();
    const header = center().firstElementChild!;
    pointerDown(header);

    escape(header);

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID);
  });

  it("keeps a held Escape to one stop request", async () => {
    const { stop } = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;

    escape(transcript);
    escape(transcript, { repeat: true });
    escape(transcript, { repeat: true });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when the last click was outside the conversation", async () => {
    const { stop } = await mount();
    pointerDown(host.querySelector(".agent-session__scroll")!);
    const sidebarRow = host.querySelector<HTMLElement>(`[data-thread-id="${THREAD_ID}"]`)!;
    expect(center().contains(sidebarRow)).toBe(false);
    pointerDown(sidebarRow);
    (document.activeElement as HTMLElement | null)?.blur();

    escape(document.body);

    expect(stop).not.toHaveBeenCalled();
  });

  it("leaves Escape to a text field inside the conversation", async () => {
    const { stop } = await mount();
    const field = document.createElement("input");
    center().append(field);
    act(() => field.focus());

    escape(field);

    expect(stop).not.toHaveBeenCalled();
    field.remove();
  });

  it("does nothing while an Escape consumer already handled the key", async () => {
    const { stop } = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;
    const consume = (event: Event): void => event.preventDefault();
    transcript.addEventListener("keydown", consume);

    escape(transcript);

    expect(stop).not.toHaveBeenCalled();
    transcript.removeEventListener("keydown", consume);
  });

  it("does nothing while a modal dialog is open", async () => {
    const { stop } = await mount();
    pointerDown(host.querySelector(".agent-session__scroll")!);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);

    escape(document.body);

    expect(stop).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("does nothing when the shown thread is not running", async () => {
    const { stop } = await mount(settledTurn());
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;

    escape(transcript);

    expect(stop).not.toHaveBeenCalled();
  });

  it("still stops exactly once from the composer prompt", async () => {
    const { stop } = await mount();
    const prompt = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => prompt.focus());

    escape(prompt);

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID);
  });
});
