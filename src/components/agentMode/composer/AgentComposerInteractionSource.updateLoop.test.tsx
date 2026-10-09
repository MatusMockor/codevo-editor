// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentQuestionGateway,
  AgentQuestionOwner,
} from "../../../application/agentQuestionPorts";
import {
  AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD,
  AGENT_PENDING_REQUEST_POLL_MS,
  type AgentPendingRequestAvailability,
} from "../../../application/agentPendingRequestPolling";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../../domain/agentQuestion";
import { waitForReact } from "../../../test/reactTestLifecycle";
import { ErrorBoundary } from "../../ErrorBoundary";
import type {
  AgentComposerInteraction,
  AgentComposerQuestionAttachmentTarget,
} from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const LOCAL_OWNER: AgentQuestionOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/repo",
  taskId: "task",
};
const REMOTE_OWNER: AgentQuestionOwner = {
  kind: "remote",
  serverId: "linux",
  runnerId: "runner",
  taskId: "task",
};
const QUESTION: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "claudeCode",
  status: "pending",
  questions: [
    {
      id: "question-0",
      header: "",
      prompt: "Which layout?",
      options: [{ id: "option-0", label: "Sidebar", description: "" }],
      multiple: false,
      allowCustom: true,
    },
  ],
};
const APPROVAL: AgentApprovalRequest = {
  id: "a1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "cargo test",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

const OWNERS = [
  { name: "remote", owner: REMOTE_OWNER },
  { name: "local", owner: LOCAL_OWNER },
];

function unreachableGateway() {
  return {
    list: vi.fn(() => Promise.reject(new Error("The runner is unreachable."))),
    answer: vi.fn(),
    listApprovals: vi.fn(() => Promise.reject(new Error("The runner is unreachable."))),
    answerApproval: vi.fn(),
  };
}

function questionGateway(): AgentQuestionGateway {
  return { list: vi.fn().mockResolvedValue([QUESTION]), answer: vi.fn() };
}

function listingGateway(
  questions: readonly AgentQuestionRequest[],
  approvals: readonly AgentApprovalRequest[],
) {
  return {
    list: vi.fn(() => Promise.resolve(structuredClone(questions))),
    answer: vi.fn(),
    listApprovals: vi.fn(() => Promise.resolve(structuredClone(approvals))),
    answerApproval: vi.fn(),
  };
}

describe("AgentComposerInteractionSource held in parent state", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let published: Array<AgentComposerInteraction | null>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    published = [];
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  function StatefulParent({
    availability,
    gateway,
    owner,
    questionAttachments,
  }: {
    readonly availability: AgentPendingRequestAvailability;
    readonly gateway: AgentQuestionGateway;
    readonly owner: AgentQuestionOwner;
    readonly questionAttachments?: AgentComposerQuestionAttachmentTarget;
  }) {
    const [interaction, setInteraction] = useState<AgentComposerInteraction | null>(null);
    const publish = useCallback((next: AgentComposerInteraction | null) => {
      published.push(next);
      setInteraction(next);
    }, []);
    return (
      <>
        <AgentComposerInteractionSource
          availability={availability}
          gateway={gateway}
          onChange={publish}
          owner={{ ...owner }}
          questionAttachments={questionAttachments && { ...questionAttachments }}
          running
        />
        <output>{interaction?.kind ?? "none"}</output>
      </>
    );
  }

  function mount(
    gateway: AgentQuestionGateway,
    owner: AgentQuestionOwner,
    availability: AgentPendingRequestAvailability = "available",
    questionAttachments?: AgentComposerQuestionAttachmentTarget,
  ): void {
    act(() =>
      root.render(
        <ErrorBoundary title="Could not load agent workspace">
          <StatefulParent
            availability={availability}
            gateway={gateway}
            owner={owner}
            questionAttachments={questionAttachments}
          />
        </ErrorBoundary>,
      ),
    );
  }

  function fallback(): string | null {
    return host.querySelector(".error-boundary-message")?.textContent ?? null;
  }

  function shown(): string | null {
    return host.querySelector("output")?.textContent ?? null;
  }

  function publishedKinds(): string[] {
    return published.map((interaction) => interaction?.kind ?? "none");
  }

  function expectShown(kind: AgentComposerInteraction["kind"] | "none"): void {
    expect(fallback()).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(shown()).toBe(kind);
  }

  async function firstPoll(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function polls(count: number): Promise<void> {
    for (let poll = 0; poll < count; poll += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_PENDING_REQUEST_POLL_MS);
      });
    }
  }

  async function interactionOrCrash(): Promise<void> {
    await waitForReact(() => expect(shown()).not.toBe("none"));
  }

  it.each(OWNERS)(
    "shows the reconnecting notice once for a $name turn whose polls keep failing",
    async ({ owner }) => {
      vi.useFakeTimers();
      mount(unreachableGateway(), owner);

      await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 1);
      const noticed = published.length;
      await polls(4);

      expectShown("notice");
      expect(published).toHaveLength(noticed);
    },
  );

  it("shows a pending question of a remote turn", async () => {
    mount(listingGateway([QUESTION], []), REMOTE_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending question of a local turn when the gateway has no approvals", async () => {
    mount(questionGateway(), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending question of a local turn when the gateway also lists approvals", async () => {
    mount(listingGateway([QUESTION], []), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending approval of a local turn", async () => {
    mount(listingGateway([], [APPROVAL]), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("approval");
  });

  it.each(OWNERS)(
    "hands the parent a $name turn's question once while polls keep listing it",
    async ({ owner }) => {
      vi.useFakeTimers();
      const gateway = listingGateway([QUESTION], []);
      mount(gateway, owner);

      await firstPoll();
      await polls(5);

      expectShown("question");
      expect(gateway.list).toHaveBeenCalledTimes(6);
      expect(publishedKinds()).toEqual(["none", "question"]);
    },
  );

  it("hands the parent a local turn's approval once while polls keep listing it", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([], [APPROVAL]);
    mount(gateway, LOCAL_OWNER);

    await firstPoll();
    await polls(5);

    expectShown("approval");
    expect(gateway.listApprovals).toHaveBeenCalledTimes(6);
    expect(publishedKinds()).toEqual(["none", "approval"]);
  });

  it("hands the parent a new interaction when the listed question changes", async () => {
    vi.useFakeTimers();
    const reworded: AgentQuestionRequest = {
      ...QUESTION,
      questions: [{ ...QUESTION.questions[0]!, prompt: "Which theme?" }],
    };
    const gateway = listingGateway([QUESTION], []);
    mount(gateway, REMOTE_OWNER);
    await firstPoll();

    gateway.list.mockImplementation(() => Promise.resolve([structuredClone(reworded)]));
    await polls(3);

    const latest = published[published.length - 1];
    expectShown("question");
    expect(publishedKinds()).toEqual(["none", "question", "question"]);
    expect(latest?.kind === "question" ? latest.request : null).toEqual(reworded);
  });

  it("keeps a remote turn's question and asks the gateway nothing while the runner is unreachable", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([QUESTION], []);
    mount(gateway, REMOTE_OWNER);
    await firstPoll();

    mount(gateway, REMOTE_OWNER, "unreachable");
    await polls(5);

    expectShown("question");
    expect(gateway.list).toHaveBeenCalledTimes(1);
    expect(gateway.listApprovals).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(publishedKinds()).toEqual(["none", "question"]);

    mount(gateway, REMOTE_OWNER, "available");
    await firstPoll();

    expect(gateway.list).toHaveBeenCalledTimes(2);
    expect(publishedKinds()).toEqual(["none", "question"]);
  });

  it.each(OWNERS)(
    "shows no reconnecting notice for a $name turn whose runner is known to be unreachable",
    async ({ owner }) => {
      vi.useFakeTimers();
      const gateway = unreachableGateway();
      mount(gateway, owner, "unreachable");

      await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 2);

      expectShown("none");
      expect(gateway.list).not.toHaveBeenCalled();
      expect(gateway.listApprovals).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("hides the reconnecting notice once the runner is known to be unreachable", async () => {
    vi.useFakeTimers();
    const gateway = unreachableGateway();
    mount(gateway, REMOTE_OWNER);
    await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 1);
    expectShown("notice");

    mount(gateway, REMOTE_OWNER, "unreachable");

    expectShown("none");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<{ readonly name: string; readonly target: AgentComposerQuestionAttachmentTarget }>([
    { name: "an unavailable reason", target: { kind: "unavailable", reason: "Not here." } },
    { name: "a thread", target: { kind: "thread", threadId: "thread-1" } },
  ])(
    "hands the parent the question once when every render passes a fresh attachment target equal to $name",
    async ({ target }) => {
      vi.useFakeTimers();
      const gateway = listingGateway([QUESTION], []);
      mount(gateway, LOCAL_OWNER, "available", target);

      await firstPoll();
      await polls(3);
      mount(gateway, LOCAL_OWNER, "available", { ...target });

      const latest = published[published.length - 1];
      expectShown("question");
      expect(publishedKinds()).toEqual(["none", "question"]);
      expect(latest?.kind === "question" ? latest.attachments : null).toEqual(target);
    },
  );

  it.each<{ readonly name: string; readonly changed: AgentComposerQuestionAttachmentTarget }>([
    { name: "another thread", changed: { kind: "thread", threadId: "thread-2" } },
    { name: "another kind", changed: { kind: "unavailable", reason: "thread-1" } },
  ])(
    "hands the parent a new interaction when the attachment target becomes $name",
    async ({ changed }) => {
      vi.useFakeTimers();
      const gateway = listingGateway([QUESTION], []);
      mount(gateway, LOCAL_OWNER, "available", { kind: "thread", threadId: "thread-1" });
      await firstPoll();

      mount(gateway, LOCAL_OWNER, "available", changed);

      const latest = published[published.length - 1];
      expectShown("question");
      expect(publishedKinds()).toEqual(["none", "question", "question"]);
      expect(latest?.kind === "question" ? latest.attachments : null).toEqual(changed);
    },
  );
});
