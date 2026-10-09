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
import { AGENT_STOP_INTERRUPTING_TEXT } from "./AgentStopConfirmationBanner";
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

function backgroundOnlyTurn(): AgentTurn {
  return {
    ...runningTurn(),
    events: [
      { kind: "backgroundTask", taskId: "watch", status: "starting", taskType: "shell" },
      { kind: "result", text: "Started", isError: false, usage: null },
    ],
    lastOutputSequence: 2,
  };
}

function settledTurn(): AgentTurn {
  return {
    ...runningTurn(),
    status: { kind: "exited", exitCode: 0 },
    endedAtEpochMs: 1_700_000_001_000,
  };
}

describe("Escape stops the running agent only from the composer prompt", () => {
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

  async function mount(
    turn: AgentTurn = runningTurn(),
    interrupt?: AgentThreadsSurface["interrupt"],
  ) {
    const stop = vi.fn(async (_threadId: string) => undefined);
    const view = surfaceThreadView({
      lifecycle: turn.status.kind === "running" ? "running" : "settled",
      thread: { ...surfaceThreadView().thread, threadId: THREAD_ID, turns: [turn] },
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({
      threads: [view],
      stop,
      ...(interrupt === undefined ? {} : { interrupt }),
    });
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

  it("leaves the agent running when focus is in the transcript instead of the composer", async () => {
    const { stop } = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;
    pointerDown(transcript);
    act(() => transcript.focus());

    const event = escape(transcript);

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(host.querySelector(".agent-composer__stop")).not.toBeNull();
  });

  it("leaves the agent running after a click in the conversation left focus on the body, as WebKit does", async () => {
    const { stop } = await mount();
    pointerDown(host.querySelector(".agent-session__scroll")!);
    (document.activeElement as HTMLElement | null)?.blur();

    const event = escape(document.body);

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the agent running on Escape from the thread header", async () => {
    const { stop } = await mount();
    const header = center().firstElementChild!;
    pointerDown(header);

    const event = escape(header);

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the agent running after a header drag-region click that left focus on a panel tab", async () => {
    const { stop } = await mount();
    const panelTab = document.createElement("button");
    panelTab.textContent = "Files";
    document.body.append(panelTab);
    pointerDown(panelTab);
    act(() => panelTab.focus());
    const header = host.querySelector<HTMLElement>("[data-agent-thread-head]")!;
    expect(center().contains(header)).toBe(true);
    pointerDown(header.querySelector(".cv-topbar__title")!);
    expect(document.activeElement).toBe(panelTab);

    escape(panelTab);

    expect(stop).not.toHaveBeenCalled();
    panelTab.remove();
  });

  it("closes the thread menu opened from the title and a later Escape still leaves the agent running", async () => {
    const { stop } = await mount();
    const title = host.querySelector<HTMLButtonElement>(".agent-crumbs__title")!;
    pointerDown(title);
    act(() => title.click());
    expect(title.getAttribute("aria-expanded")).toBe("true");

    escape(document.activeElement ?? document.body);

    expect(stop).not.toHaveBeenCalled();
    expect(title.getAttribute("aria-expanded")).toBe("false");

    escape(document.activeElement ?? document.body);

    expect(stop).not.toHaveBeenCalled();
  });

  it("leaves the agent running through a held Escape outside the composer", async () => {
    const { stop } = await mount();
    const transcript = host.querySelector<HTMLElement>(".agent-session__scroll")!;
    pointerDown(transcript);

    escape(transcript);
    escape(transcript, { repeat: true });
    escape(transcript, { repeat: true });

    expect(stop).not.toHaveBeenCalled();
  });

  it("stops exactly once from the composer prompt", async () => {
    const { stop } = await mount();
    const prompt = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => prompt.focus());

    const event = escape(prompt);

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "composerEscape",
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps a held Escape in the composer prompt to one stop request", async () => {
    const { stop } = await mount();
    const prompt = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => prompt.focus());

    escape(prompt);
    escape(prompt, { repeat: true });
    escape(prompt, { repeat: true });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops from the Stop button", async () => {
    const { stop } = await mount();
    const button = host.querySelector<HTMLButtonElement>(".agent-composer__stop");
    expect(button).not.toBeNull();

    await act(async () => button?.click());

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "composerStopButton",
    });
  });

  const CONFIRMATION = "1 background task is still running. Press Stop or Esc again to end it.";

  function promptField(): HTMLTextAreaElement {
    const prompt = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea");
    expect(prompt).not.toBeNull();
    return prompt ?? document.createElement("textarea");
  }

  async function clickStop(): Promise<void> {
    const button = host.querySelector<HTMLButtonElement>(".agent-composer__stop");
    expect(button).not.toBeNull();
    await act(async () => button?.click());
  }

  it("moves focus to the prompt when Stop asks for confirmation so a second Escape confirms", async () => {
    const { stop } = await mount(backgroundOnlyTurn());
    act(() => promptField().blur());
    expect(document.activeElement).not.toBe(promptField());

    await clickStop();

    expect(host.textContent).toContain(CONFIRMATION);
    expect(stop).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(promptField());

    const event = escape(document.activeElement ?? document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "composerEscape",
    });
    expect(host.textContent).not.toContain(CONFIRMATION);
  });

  it("confirms with a second press of Stop and names the button as the source", async () => {
    const { stop } = await mount(backgroundOnlyTurn());

    await clickStop();
    expect(stop).not.toHaveBeenCalled();
    await clickStop();

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "composerStopButton",
    });
  });

  it("names the confirmation banner as the source of Stop everything", async () => {
    const { stop } = await mount(backgroundOnlyTurn());
    await clickStop();
    const stopEverything = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Stop everything",
    );
    expect(stopEverything).toBeDefined();

    await act(async () => stopEverything?.click());

    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "stopConfirmationBanner",
    });
  });

  it("leaves focus in an open modal when Stop asks for confirmation", async () => {
    const { stop } = await mount(backgroundOnlyTurn());
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const field = document.createElement("input");
    modal.append(field);
    document.body.append(modal);
    act(() => field.focus());

    await clickStop();

    expect(host.textContent).toContain(CONFIRMATION);
    expect(document.activeElement).toBe(field);
    expect(stop).not.toHaveBeenCalled();
    modal.remove();
  });

  it("leaves focus in another text field when Stop asks for confirmation", async () => {
    await mount(backgroundOnlyTurn());
    const editor = document.createElement("textarea");
    document.body.append(editor);
    act(() => editor.focus());

    await clickStop();

    expect(host.textContent).toContain(CONFIRMATION);
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it("leaves focus on an open menu trigger when the interrupt confirmation arrives later", async () => {
    let accept: (accepted: boolean) => void = () => undefined;
    const interrupt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const { stop } = await mount(runningTurn(), interrupt);
    await clickStop();
    expect(interrupt).toHaveBeenCalledExactlyOnceWith(THREAD_ID, "composerStopButton");
    expect(host.textContent).not.toContain(AGENT_STOP_INTERRUPTING_TEXT);
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "true");
    document.body.append(trigger);
    act(() => trigger.focus());

    await act(async () => accept(true));

    expect(host.textContent).toContain(AGENT_STOP_INTERRUPTING_TEXT);
    expect(document.activeElement).toBe(trigger);
    expect(stop).not.toHaveBeenCalled();
    trigger.remove();
  });

  it("moves focus to the prompt when the interrupt confirmation arrives and no menu is open", async () => {
    const interrupt = vi.fn(async () => true);
    const { stop } = await mount(runningTurn(), interrupt);
    act(() => promptField().blur());

    await clickStop();

    expect(host.textContent).toContain(AGENT_STOP_INTERRUPTING_TEXT);
    expect(document.activeElement).toBe(promptField());
    escape(promptField());
    expect(stop).toHaveBeenCalledExactlyOnceWith(THREAD_ID, {
      kind: "ui",
      source: "composerEscape",
    });
  });

  it("does nothing from the composer prompt when the shown thread is not running", async () => {
    const { stop } = await mount(settledTurn());
    const prompt = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
    act(() => prompt.focus());

    const event = escape(prompt);

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
