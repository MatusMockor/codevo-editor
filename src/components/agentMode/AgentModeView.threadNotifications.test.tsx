// @vitest-environment jsdom
import { act } from "react";
import { AGENT_PENDING_INTERACTION_POLL_MS } from "../../application/useAgentPendingInteractions";
import { AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS } from "../../application/agentThreadNotificationCenter";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentThreadNotificationCenter,
  type AgentAppFocusPort,
  type AgentSystemAttentionPort,
  type AgentSystemNotification,
} from "../../application/agentThreadNotificationCenter";
import type { AgentApprovalGateway } from "../../application/agentApprovalPorts";
import type {
  AgentQuestionGateway,
  AgentQuestionOwner,
} from "../../application/agentQuestionPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentApprovalRequest } from "../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../domain/agentQuestion";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const APP = "/workspace/app";
const API = "/workspace/api-service";

class FakeFocus implements AgentAppFocusPort {
  private listeners = new Set<(focused: boolean) => void>();
  focused = true;
  isFocused(): boolean {
    return this.focused;
  }
  subscribe(listener: (focused: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class FakeSystem implements AgentSystemAttentionPort {
  readonly notifications: AgentSystemNotification[] = [];
  readonly badges: number[] = [];
  async notify(notification: AgentSystemNotification) {
    this.notifications.push(notification);
    return "delivered" as const;
  }
  async setBadgeCount(count: number): Promise<void> {
    this.badges.push(count);
  }
  rechecks = 0;
  recheckPermission(): void {
    this.rechecks += 1;
  }
}

function project(rootKey: string, label: string, generation = 1): AgentProjectDescriptor {
  return projectFixture({
    generation,
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${label}`,
    label,
    repositories: [fixtureRepository(rootKey, "")],
  });
}

function turn(status: AgentTurnStatus, turnId: string): AgentTurn {
  const live = status.kind === "running";
  return {
    turnId,
    prompt: "Do the work",
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: live ? null : 1_700_000_100_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function threadIn(
  threadId: string,
  rootKey: string,
  label: string,
  status: AgentTurnStatus,
  extras: { readonly archived?: boolean; readonly background?: boolean } = {},
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: label,
    lifecycle: extras.archived ? "archived" : status.kind === "running" ? "running" : "settled",
    ...(extras.background
      ? {
          sessionBackground: {
            ownerId: `agent-root:${label}`,
            total: 1,
            agents: 0,
            tasks: [],
            sinceEpochMs: 1_700_000_000_000,
            taskSinceEpochMs: new Map(),
          },
        }
      : {}),
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      archived: extras.archived ?? false,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${label}`, repositoryRoot: rootKey },
      turns: [turn(status, `${threadId}-turn`)],
    },
  });
}

class FakeInteractionGateway implements AgentQuestionGateway, AgentApprovalGateway {
  readonly approvals = new Map<string, string>();

  async list(): Promise<readonly AgentQuestionRequest[]> {
    return [];
  }

  async answer(): Promise<never> {
    throw new Error("unused");
  }

  async listApprovals(owner: AgentQuestionOwner): Promise<readonly AgentApprovalRequest[]> {
    const id = this.approvals.get(owner.taskId);
    return id === undefined ? [] : [{ id, status: "pending" } as AgentApprovalRequest];
  }

  async answerApproval(): Promise<never> {
    throw new Error("unused");
  }
}

const RUNNING = { kind: "running" } as const;
const DONE = { kind: "exited", exitCode: 0 } as const;

describe("agent thread notifications in agent mode", () => {
  let host: HTMLDivElement;
  let root: Root;
  let focus: FakeFocus;
  let system: FakeSystem;
  let stopCenter: () => void;
  const selectWorkspace = vi.fn<(project: AgentProjectDescriptor | null) => void>();
  let center: ReturnType<typeof createAgentThreadNotificationCenter>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectWorkspace.mockReset();
    focus = new FakeFocus();
    system = new FakeSystem();
    center = createAgentThreadNotificationCenter({ focus, system, now: () => Date.now() });
    stopCenter = center.start();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    stopCenter();
    host.remove();
  });

  function props(
    threads: AgentThreadView[],
    questionGateway: AgentQuestionGateway | null = null,
    projects?: AgentProjectDescriptor[],
  ): AgentModeViewProps {
    return {
      questionGateway,
      agents: {
        ...threadsSurfaceFixture({
          threads,
          repositories: [fixtureRepository(APP, ""), fixtureRepository(API, "")],
        }),
        providerManagement: unconfiguredAgentProviderManagement(),
      },
      projects: projects ?? [project(APP, "app"), project(API, "api-service")],
      workspaceRoot: APP,
      overflowRootPaths: [],
      providerEnabled: { claudeCode: true, codex: true },
      chrome: chromeFixture({
        workspaceActivation: {
          select: selectWorkspace,
          state: { kind: "none", rootPath: null },
          retry: () => undefined,
        },
      }),
      threadNotifications: center,
      onTrustProject: () => undefined,
      onReleaseProject: () => undefined,
    };
  }

  function render(
    threads: AgentThreadView[],
    options: {
      readonly key?: string;
      readonly gateway?: AgentQuestionGateway | null;
      readonly projects?: AgentProjectDescriptor[];
      readonly notificationsVisible?: boolean;
    } = {},
  ): void {
    act(() =>
      root.render(
        <AgentModeView
          key={options.key ?? "view"}
          {...props(threads, options.gateway ?? null, options.projects)}
          threadNotificationsVisible={options.notificationsVisible ?? true}
        />,
      ),
    );
  }

  function messages(): Array<string | null | undefined> {
    return toasts().map((toast) =>
      [".toast-notification__title", ".toast-notification-message", ".toast-notification__meta"]
        .map((selector) => toast.querySelector(selector)?.textContent)
        .join(" | "),
    );
  }

  function clickRow(threadId: string): void {
    const row = host.querySelector<HTMLElement>(`.agent-rail [data-thread-id="${threadId}"]`);
    expect(row).not.toBeNull();
    act(() => row?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  function selectedSession(): string | null {
    const section = host.querySelector<HTMLElement>('section[aria-label^="Agent thread "]');
    return section?.getAttribute("aria-label")?.replace("Agent thread ", "") ?? null;
  }

  function toasts(): HTMLElement[] {
    return [
      ...document.querySelectorAll<HTMLElement>(".toast-region--agent-threads .toast-notification"),
    ];
  }

  function openButton(toast: HTMLElement): HTMLButtonElement {
    const button = [...toast.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Open",
    );
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  it("toasts a thread in another project that finishes, and Open jumps to it", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    expect(selectedSession()).toBe("a1");

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);

    expect(messages()).toEqual(["Thread finished | Thread b1 | api-service"]);
    selectWorkspace.mockClear();
    act(() => openButton(toasts()[0] as HTMLElement).click());

    expect(selectedSession()).toBe("b1");
    expect(selectWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootKey: API, ownerId: "agent-root:api-service" }),
    );
    expect(toasts()).toEqual([]);
  });

  it("keeps thread toasts out of the shared stack while they are hidden", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);
    expect(toasts()).toHaveLength(1);

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)], {
      notificationsVisible: false,
    });
    expect(toasts()).toEqual([]);

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);
    expect(messages()).toEqual(["Thread finished | Thread b1 | api-service"]);
  });

  it("does not toast the thread the user is looking at", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");

    render([threadIn("a1", APP, "app", DONE), threadIn("b1", API, "api-service", RUNNING)]);

    expect(toasts()).toEqual([]);
    expect(system.notifications).toEqual([]);
  });

  it("sends a system notification instead while the window is unfocused", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    focus.focused = false;

    render([threadIn("a1", APP, "app", DONE), threadIn("b1", API, "api-service", RUNNING)]);

    expect(system.notifications).toEqual([{ title: "Thread finished", body: "Thread a1 · app" }]);
    expect(system.badges[system.badges.length - 1]).toBe(1);
    expect(toasts()).toEqual([]);
  });

  it("withdraws a toast whose thread was replaced by another owner or removed", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);
    expect(toasts()).toHaveLength(1);

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", APP, "app", DONE)]);
    expect(toasts()).toEqual([]);
    expect(selectedSession()).toBe("a1");

    render([threadIn("a1", APP, "app", RUNNING), threadIn("c1", API, "api-service", RUNNING)]);
    render([threadIn("a1", APP, "app", RUNNING), threadIn("c1", API, "api-service", DONE)]);
    expect(toasts()).toHaveLength(1);
    render([threadIn("a1", APP, "app", RUNNING)]);
    expect(toasts()).toEqual([]);
  });

  it("re-baselines threads when their project reloads under a new generation", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)], {
      projects: [project(APP, "app"), project(API, "api-service", 2)],
    });

    expect(toasts()).toEqual([]);
  });

  it("stays silent when notifications are turned off", () => {
    center.setEnabled(false);
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");

    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);

    expect(toasts()).toEqual([]);
    expect(system.notifications).toEqual([]);
  });

  it("does not repeat an approval after the agent view remounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const gateway = new FakeInteractionGateway();
    const threads = [
      threadIn("a1", APP, "app", RUNNING),
      threadIn("b1", API, "api-service", RUNNING),
    ];
    const settle = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    render(threads, { key: "first", gateway });
    clickRow("a1");
    await settle(0);

    gateway.approvals.set("b1-turn", "req-1");
    await settle(AGENT_PENDING_INTERACTION_POLL_MS);
    expect(messages()).toEqual(["Approval needed | Thread b1 | api-service"]);
    act(() =>
      toasts()[0]
        ?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification"]')
        ?.click(),
    );
    expect(toasts()).toEqual([]);

    await settle(AGENT_THREAD_NOTIFICATION_DEBOUNCE_MS + 1);
    render(threads, { key: "second", gateway });
    await settle(0);
    await settle(AGENT_PENDING_INTERACTION_POLL_MS);

    expect(toasts()).toEqual([]);
  });

  it("only re-baselines a thread that is unarchived", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    render([
      threadIn("a1", APP, "app", RUNNING),
      threadIn("b1", API, "api-service", DONE, { archived: true }),
    ]);
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", DONE)]);

    expect(toasts()).toEqual([]);
  });

  it("reports a finished turn even while session background tasks keep running", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    render([
      threadIn("a1", APP, "app", RUNNING),
      threadIn("b1", API, "api-service", DONE, { background: true }),
    ]);

    expect(messages()).toEqual(["Thread finished | Thread b1 | api-service"]);
  });

  it("stays silent for an interrupted turn", () => {
    render([threadIn("a1", APP, "app", RUNNING), threadIn("b1", API, "api-service", RUNNING)]);
    clickRow("a1");
    render([
      threadIn("a1", APP, "app", RUNNING),
      threadIn("b1", API, "api-service", { kind: "interrupted" }),
    ]);

    expect(toasts()).toEqual([]);
  });
});
