// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentThreadNotificationCenter,
  type AgentAppFocusPort,
  type AgentThreadNotificationCenter,
  type AgentSystemAttentionPort,
} from "../../application/agentThreadNotificationCenter";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentThreadNotificationCenter } from "../../application/useAgentThreadNotificationCenter";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTurnStatus } from "../../domain/agentThread";
import {
  AGENT_THREAD_NOTIFICATION_TOAST_MS,
  AgentThreadNotifications,
} from "./AgentThreadNotifications";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";

const FOCUSED: AgentAppFocusPort = { isFocused: () => true, subscribe: () => () => undefined };
const SYSTEM: AgentSystemAttentionPort = {
  notify: async () => "delivered",
  setBadgeCount: async () => undefined,
  recheckPermission: () => undefined,
};
const PORTS = () => ({ focus: FOCUSED, system: SYSTEM });

function view(threadId: string, status: AgentTurnStatus, repositoryLabel = "api"): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel,
    lifecycle: status.kind === "running" ? "running" : "settled",
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      turns: [
        {
          turnId: `${threadId}-turn`,
          prompt: "go",
          status,
          startedAtEpochMs: 1,
          endedAtEpochMs: status.kind === "running" ? null : 2,
          events: [],
          eventsTruncated: false,
          lastStatusSequence: 1,
          lastOutputSequence: 0,
          launch: null,
          cliVersion: null,
        },
      ],
    },
  });
}

function Harness({
  settingsOpen,
  views,
  visibleThreadId,
}: {
  readonly settingsOpen: boolean;
  readonly views: ReadonlyArray<AgentThreadView>;
  readonly visibleThreadId: string | null;
}) {
  const center = useAgentThreadNotificationCenter(
    { enabled: true, toastsVisible: !settingsOpen, threadViewVisible: !settingsOpen },
    PORTS,
  );
  return (
    <AgentThreadNotifications
      center={center}
      interactions={new Map()}
      onSelectThread={() => undefined}
      projects={[]}
      views={views}
      visibleThreadId={visibleThreadId}
    />
  );
}

describe("AgentThreadNotifications", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("uses the thread shown after Settings closes when it releases held events", () => {
    const running = [view("a1", { kind: "running" }), view("b1", { kind: "running" })];
    const finished = [view("a1", { kind: "running" }), view("b1", { kind: "exited", exitCode: 0 })];
    act(() => root.render(<Harness settingsOpen={false} views={running} visibleThreadId="a1" />));
    act(() => root.render(<Harness settingsOpen views={finished} visibleThreadId="a1" />));
    expect(document.querySelectorAll(".toast-notification")).toHaveLength(0);

    act(() => root.render(<Harness settingsOpen={false} views={finished} visibleThreadId="b1" />));

    expect(document.querySelectorAll(".toast-notification")).toHaveLength(0);
  });

  describe("cards", () => {
    const RUNNING = { kind: "running" } as const;
    const DONE = { kind: "exited", exitCode: 0 } as const;
    const FAILED = { kind: "exited", exitCode: 1 } as const;
    let center: AgentThreadNotificationCenter;
    let selected: string[];

    beforeEach(() => {
      center = createAgentThreadNotificationCenter({ focus: FOCUSED, system: SYSTEM });
      selected = [];
    });

    function show(views: ReadonlyArray<AgentThreadView>, toastsVisible = true): void {
      act(() =>
        root.render(
          <AgentThreadNotifications
            center={center}
            interactions={new Map()}
            onSelectThread={(threadId) => selected.push(threadId)}
            projects={[]}
            toastsVisible={toastsVisible}
            views={views}
            visibleThreadId="a1"
          />,
        ),
      );
    }

    function finish(status: AgentTurnStatus, label = "api"): void {
      show([view("a1", RUNNING), view("b1", RUNNING, label)]);
      show([view("a1", RUNNING), view("b1", status, label)]);
    }

    function cards(): HTMLElement[] {
      return [
        ...document.querySelectorAll<HTMLElement>(
          ".toast-region--agent-threads .toast-notification",
        ),
      ];
    }

    function text(card: HTMLElement | undefined, selector: string): string | null {
      return card?.querySelector(selector)?.textContent ?? null;
    }

    function buttons(card: HTMLElement | undefined): string[] {
      return [...(card?.querySelectorAll("button") ?? [])].map(
        (button) => button.textContent || button.getAttribute("aria-label") || "",
      );
    }

    function advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }

    it("shows a finished thread as a success card with the project as meta", () => {
      finish(DONE);

      const card = cards()[0];
      expect(cards()).toHaveLength(1);
      expect(card?.classList.contains("toast-notification--success")).toBe(true);
      expect(text(card, ".toast-notification__title")).toBe("Thread finished");
      expect(text(card, ".toast-notification-message")).toBe("Thread b1");
      expect(text(card, ".toast-notification__meta")).toBe("api");
      expect(buttons(card)).toEqual(["Dismiss notification", "Open"]);
    });

    it("shows a failed thread as an error card", () => {
      finish(FAILED);

      const card = cards()[0];
      expect(card?.classList.contains("toast-notification--error")).toBe(true);
      expect(card?.getAttribute("role")).toBe("alert");
      expect(text(card, ".toast-notification__title")).toBe("Thread failed");
    });

    it("omits the meta row when the project label is empty", () => {
      finish(DONE, "");

      expect(cards()[0]?.querySelector(".toast-notification__meta")).toBeNull();
    });

    it("opens the thread from the primary action and removes the card", () => {
      finish(DONE);

      const open = [...(cards()[0]?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Open",
      );
      expect(open?.classList.contains("toast-notification-action--primary")).toBe(true);
      act(() => open?.click());

      expect(selected).toEqual(["b1"]);
      expect(cards()).toEqual([]);
    });

    it("shows an unavailable thread as an info card without an Open action", () => {
      show([view("a1", RUNNING)]);
      act(() =>
        center.reportUnavailable({
          threadId: "gone",
          ownerKey: "owner",
          title: "Old work",
          projectLabel: "api",
          kind: "completed",
          signalKey: "s",
          key: "k",
        }),
      );

      const card = cards()[0];
      expect(card?.classList.contains("toast-notification--info")).toBe(true);
      expect(text(card, ".toast-notification__title")).toBe("Thread unavailable");
      expect(text(card, ".toast-notification-message")).toBe("Old work");
      expect(buttons(card)).toEqual(["Dismiss notification"]);
    });

    it("dismisses on the close button and on Escape", () => {
      finish(DONE);
      act(() =>
        cards()[0]
          ?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification"]')
          ?.click(),
      );
      expect(cards()).toEqual([]);

      show([view("a1", RUNNING), view("c1", RUNNING)]);
      show([view("a1", RUNNING), view("c1", DONE)]);
      expect(cards()).toHaveLength(1);
      act(() => {
        cards()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      });
      expect(cards()).toEqual([]);
    });

    it("auto-dismisses after the timeout and pauses while hovered", () => {
      vi.useFakeTimers();
      finish(DONE);
      const slot = cards()[0]?.parentElement as HTMLElement;

      advance(AGENT_THREAD_NOTIFICATION_TOAST_MS - 1_000);
      act(() => {
        slot.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      });
      advance(AGENT_THREAD_NOTIFICATION_TOAST_MS * 2);
      expect(cards()).toHaveLength(1);

      act(() => {
        slot.dispatchEvent(
          new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
        );
      });
      advance(999);
      expect(cards()).toHaveLength(1);
      advance(1);
      expect(cards()).toEqual([]);
    });

    it("stacks the newest card in front and gives the older one a full countdown when it surfaces", () => {
      vi.useFakeTimers();
      const running = [view("a1", RUNNING), view("b1", RUNNING), view("c1", RUNNING)];
      show(running);
      show([view("a1", RUNNING), view("b1", DONE), view("c1", RUNNING)]);
      advance(AGENT_THREAD_NOTIFICATION_TOAST_MS - 1_000);
      show([view("a1", RUNNING), view("b1", DONE), view("c1", DONE)]);

      const region = document.querySelector(".toast-region--agent-threads");
      expect(region?.classList.contains("toast-region--stacked")).toBe(true);
      expect(cards().map((card) => text(card, ".toast-notification-message"))).toEqual([
        "Thread c1",
        "Thread b1",
      ]);
      const behind = cards()[1]?.parentElement;
      expect(behind?.classList.contains("toast-region__slot--behind")).toBe(true);
      expect(behind?.getAttribute("aria-hidden")).toBe("true");
      expect(behind?.hasAttribute("inert")).toBe(true);

      advance(AGENT_THREAD_NOTIFICATION_TOAST_MS);
      expect(cards().map((card) => text(card, ".toast-notification-message"))).toEqual([
        "Thread b1",
      ]);
      advance(AGENT_THREAD_NOTIFICATION_TOAST_MS - 1);
      expect(cards()).toHaveLength(1);
      advance(1);
      expect(cards()).toEqual([]);
    });

    it("hides the cards while toasts are not visible and shows them again afterwards", () => {
      finish(DONE);
      expect(cards()).toHaveLength(1);

      show([view("a1", RUNNING), view("b1", DONE)], false);
      expect(document.querySelector(".toast-region--agent-threads")).toBeNull();

      show([view("a1", RUNNING), view("b1", DONE)]);
      expect(cards().map((card) => text(card, ".toast-notification-message"))).toEqual([
        "Thread b1",
      ]);
    });
  });

  describe("while the session levels are still being recovered", () => {
    const RUNNING = { kind: "running" } as const;
    const DONE = { kind: "exited", exitCode: 0 } as const;
    let center: AgentThreadNotificationCenter;

    beforeEach(() => {
      center = createAgentThreadNotificationCenter({ focus: FOCUSED, system: SYSTEM });
    });

    function show(
      views: ReadonlyArray<AgentThreadView>,
      baselineReady: boolean,
      projects: ReadonlyArray<AgentProjectDescriptor> = [],
    ): void {
      act(() =>
        root.render(
          <AgentThreadNotifications
            baselineReady={baselineReady}
            center={center}
            interactions={new Map()}
            onSelectThread={() => undefined}
            projects={projects}
            views={views}
            visibleThreadId="a1"
          />,
        ),
      );
    }

    function notified(): string[] {
      return center.toasts().map((toast) => toast.event.threadId);
    }

    function unhydrated(threadId: string): AgentThreadView {
      const settled = view(threadId, DONE);
      return { ...settled, thread: { ...settled.thread, turns: [] } };
    }

    it("notifies about the turn that finished during the recovery and about no thread that never ran", () => {
      const history = Array.from({ length: 200 }, (_unused, index) => `h${index}`);
      show([view("a1", RUNNING), view("b1", RUNNING), ...history.map(unhydrated)], false);
      const later = [
        view("a1", RUNNING),
        view("b1", DONE),
        ...history.map((threadId) => view(threadId, DONE)),
      ];
      show(later, false);
      expect(notified()).toEqual([]);

      show(later, true);

      expect(notified()).toEqual(["b1"]);
    });

    it("forgets a thread it watched once that thread belongs to another owner generation", () => {
      const rootKey = view("b1", RUNNING).thread.owner.rootKey;
      const loaded = [projectFixture({ rootKey, generation: 1 })];
      const reloaded = [projectFixture({ rootKey, generation: 2 })];
      const finished = [view("a1", RUNNING), view("b1", DONE)];
      show([view("a1", RUNNING), view("b1", RUNNING)], false, loaded);
      show(finished, false, reloaded);
      show(finished, false, loaded);

      show(finished, true, loaded);

      expect(notified()).toEqual([]);
    });

    it("still notifies when the owner stayed the same throughout the recovery", () => {
      const rootKey = view("b1", RUNNING).thread.owner.rootKey;
      const loaded = [projectFixture({ rootKey, generation: 1 })];
      const finished = [view("a1", RUNNING), view("b1", DONE)];
      show([view("a1", RUNNING), view("b1", RUNNING)], false, loaded);
      show(finished, false, loaded);

      show(finished, true, loaded);

      expect(notified()).toEqual(["b1"]);
    });
  });
});
