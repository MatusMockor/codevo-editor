import { describe, expect, it, vi } from "vitest";
import type { AgentInteractionOwner } from "../application/agentInteractionPorts";
import { isAgentInteractionFeed } from "../application/agentInteractionPorts";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import {
  AGENT_INTERACTIONS_EVENT,
  TauriAgentInteractionFeed,
  type AgentInteractionRuntimeDetector,
  type InvokeAgentInteractionCommand,
  type ListenToAgentInteractionEvent,
} from "./tauriAgentInteractionFeed";

const owner: AgentInteractionOwner = { workspaceId: "workspace", taskId: "task-1" };

const question = {
  id: "question-1",
  taskId: "task-1",
  provider: "codex",
  status: "pending",
  questions: [
    { id: "q", header: "", prompt: "Which?", multiple: false, allowCustom: true, options: [] },
  ],
};

const approval = {
  id: "approval-1",
  taskId: "task-1",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "ls",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

const wire = {
  taskId: "task-1",
  workspaceId: "workspace",
  sequence: 3,
  questions: [question],
  approvals: [approval],
};

const available: AgentInteractionRuntimeDetector = () => true;
const unavailable: AgentInteractionRuntimeDetector = () => false;

type InteractionEventHandler = (event: { payload: unknown }) => void;

function fakeEventBus() {
  const handlers = new Map<string, Set<InteractionEventHandler>>();
  const listen = vi.fn<ListenToAgentInteractionEvent>((event, handler) => {
    const subscribed = handlers.get(event) ?? new Set<InteractionEventHandler>();
    subscribed.add(handler);
    handlers.set(event, subscribed);
    return Promise.resolve(() => {
      subscribed.delete(handler);
    });
  });
  const emit = (event: string, payload: unknown): void => {
    handlers.get(event)?.forEach((handler) => handler({ payload }));
  };
  return { listen, emit };
}

function feedReturning(payload: unknown) {
  const invoke = vi.fn<InvokeAgentInteractionCommand>().mockResolvedValue(payload);
  return { invoke, feed: new TauriAgentInteractionFeed(invoke, vi.fn(), available) };
}

describe("TauriAgentInteractionFeed", () => {
  it("satisfies the interaction feed port", () => {
    expect(isAgentInteractionFeed(new TauriAgentInteractionFeed(vi.fn(), vi.fn(), available))).toBe(
      true,
    );
  });

  it("requests the current snapshot with exactly the workspace and task identity", async () => {
    const { invoke, feed } = feedReturning(wire);

    await expect(feed.currentInteractions(owner)).resolves.toStrictEqual(wire);

    expect(invoke.mock.calls).toStrictEqual([
      ["get_agent_interactions", { request: { workspaceId: "workspace", taskId: "task-1" } }],
    ]);
  });

  it("never forwards fields beyond the workspace and task identity", async () => {
    const { invoke, feed } = feedReturning(wire);
    const widened = { ...owner, kind: "local", repositoryRoot: "/repo/nested" };

    await feed.currentInteractions(widened);

    expect(invoke.mock.calls[0]?.[1]).toStrictEqual({
      request: { workspaceId: "workspace", taskId: "task-1" },
    });
  });

  it("accepts the empty snapshot the backend returns for an unknown task", async () => {
    const empty = { ...wire, sequence: 0, questions: [], approvals: [] };
    const { feed } = feedReturning(empty);

    await expect(feed.currentInteractions(owner)).resolves.toStrictEqual(empty);
  });

  it.each([
    ["foreign workspace", { ...wire, workspaceId: "workspace-2" }],
    ["foreign task", { ...wire, taskId: "task-2", questions: [], approvals: [] }],
    ["unknown snapshot key", { ...wire, repositoryRoot: "/repo" }],
    ["unknown question key", { ...wire, questions: [{ ...question, extra: true }] }],
    ["unknown approval key", { ...wire, approvals: [{ ...approval, extra: true }] }],
    ["missing approvals", { ...wire, approvals: undefined }],
    ["missing sequence", { ...wire, sequence: undefined }],
    ["negative sequence", { ...wire, sequence: -1 }],
    ["fractional sequence", { ...wire, sequence: 1.5 }],
    ["textual sequence", { ...wire, sequence: "3" }],
    ["question of another task", { ...wire, questions: [{ ...question, taskId: "task-2" }] }],
    ["approval of another task", { ...wire, approvals: [{ ...approval, taskId: "task-2" }] }],
    ["duplicate questions", { ...wire, questions: [question, question] }],
    ["duplicate approvals", { ...wire, approvals: [approval, approval] }],
    [
      "too many questions",
      {
        ...wire,
        questions: Array.from({ length: 33 }, (_, index) => ({ ...question, id: `q-${index}` })),
      },
    ],
    [
      "too many approvals",
      {
        ...wire,
        approvals: Array.from({ length: 33 }, (_, index) => ({ ...approval, id: `a-${index}` })),
      },
    ],
    ["list instead of snapshot", [wire]],
    ["null", null],
    ["text", "snapshot"],
  ])("rejects a current snapshot with %s", async (_label, payload) => {
    const { feed } = feedReturning(payload);

    await expect(feed.currentInteractions(owner)).rejects.toThrow();
  });

  it.each([
    ["blank workspace", { workspaceId: "", taskId: "task-1" }],
    ["path-like workspace", { workspaceId: "/repo", taskId: "task-1" }],
    ["blank task", { workspaceId: "workspace", taskId: "" }],
    ["oversized task", { workspaceId: "workspace", taskId: "t".repeat(129) }],
  ])("rejects an owner with %s before reaching the transport", async (_label, invalidOwner) => {
    const { invoke, feed } = feedReturning(wire);

    await expect(feed.currentInteractions(invalidOwner)).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection instead of inventing a snapshot", async () => {
    const invoke = vi
      .fn<InvokeAgentInteractionCommand>()
      .mockRejectedValue(new Error("Workspace is not registered."));
    const feed = new TauriAgentInteractionFeed(invoke, vi.fn(), available);

    await expect(feed.currentInteractions(owner)).rejects.toThrow("Workspace is not registered.");
  });

  it("delivers every valid pushed snapshot without filtering by owner", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentInteractionFeed(vi.fn(), bus.listen, available);
    const received: AgentInteractionSnapshot[] = [];
    const foreign = {
      taskId: "task-9",
      workspaceId: "workspace-9",
      sequence: 1,
      questions: [],
      approvals: [{ ...approval, taskId: "task-9" }],
    };

    await feed.subscribeInteractions((snapshot) => received.push(snapshot));
    bus.emit(AGENT_INTERACTIONS_EVENT, wire);
    bus.emit(AGENT_INTERACTIONS_EVENT, foreign);

    expect(bus.listen.mock.calls.map(([event]) => event)).toStrictEqual([
      "agent-task://interactions",
    ]);
    expect(received).toStrictEqual([wire, foreign]);
  });

  it("drops malformed pushed snapshots without throwing into the event loop", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentInteractionFeed(vi.fn(), bus.listen, available);
    const handler = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();
    const malformed: readonly unknown[] = [
      null,
      undefined,
      "snapshot",
      [wire],
      { ...wire, extra: true },
      { ...wire, sequence: -1 },
      { ...wire, workspaceId: "" },
      { ...wire, questions: [{ ...question, taskId: "task-2" }] },
      { ...wire, approvals: [approval, approval] },
      { ...wire, questions: "none" },
      {
        ...wire,
        approvals: Array.from({ length: 33 }, (_, index) => ({ ...approval, id: `a-${index}` })),
      },
    ];

    await feed.subscribeInteractions(handler);
    malformed.forEach((payload) => bus.emit(AGENT_INTERACTIONS_EVENT, payload));

    expect(handler).not.toHaveBeenCalled();

    bus.emit(AGENT_INTERACTIONS_EVENT, wire);

    expect(handler.mock.calls).toStrictEqual([[wire]]);
  });

  it("ignores events published on other channels", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentInteractionFeed(vi.fn(), bus.listen, available);
    const handler = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();

    await feed.subscribeInteractions(handler);
    bus.emit("agent-task://status", wire);

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe while other subscribers keep receiving", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentInteractionFeed(vi.fn(), bus.listen, available);
    const first = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();
    const second = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();

    const unsubscribeFirst = await feed.subscribeInteractions(first);
    await feed.subscribeInteractions(second);
    bus.emit(AGENT_INTERACTIONS_EVENT, wire);
    unsubscribeFirst();
    bus.emit(AGENT_INTERACTIONS_EVENT, { ...wire, sequence: 4 });

    expect(first.mock.calls).toStrictEqual([[wire]]);
    expect(second.mock.calls).toStrictEqual([[wire], [{ ...wire, sequence: 4 }]]);
  });

  it("degrades to an empty snapshot and a no-op subscription without the native runtime", async () => {
    const invoke = vi.fn<InvokeAgentInteractionCommand>();
    const listen = vi.fn<ListenToAgentInteractionEvent>();
    const feed = new TauriAgentInteractionFeed(invoke, listen, unavailable);
    const handler = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();

    await expect(feed.currentInteractions(owner)).resolves.toStrictEqual({
      workspaceId: "workspace",
      taskId: "task-1",
      sequence: 0,
      questions: [],
      approvals: [],
    });
    const unsubscribe = await feed.subscribeInteractions(handler);
    unsubscribe();

    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("still rejects an invalid owner without the native runtime", async () => {
    const feed = new TauriAgentInteractionFeed(vi.fn(), vi.fn(), unavailable);

    await expect(
      feed.currentInteractions({ workspaceId: "workspace", taskId: "" }),
    ).rejects.toThrow();
  });
});
