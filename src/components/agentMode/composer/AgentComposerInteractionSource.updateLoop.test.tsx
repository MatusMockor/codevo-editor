// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInteractionFeed } from "../../../application/agentInteractionPorts";
import {
  AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD,
  AGENT_INTERACTION_RETRY_BASE_MS,
  AGENT_INTERACTION_RETRY_CAP_MS,
} from "../../../application/agentInteractionStore";
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
import { FakeAgentInteractionGateway } from "../agentInteractionGatewayTestFixtures";
import type {
  AgentComposerInteraction,
  AgentComposerQuestionAttachmentTarget,
} from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const LOCAL_OWNER: AgentQuestionOwner = {
  kind: "local",
  workspaceId: "workspace",
  taskId: "task",
};
const LOCAL_FEED_OWNER = { workspaceId: "workspace", taskId: "task" };
const LOCAL_RETRY_AFTER_NOTICE_MS =
  AGENT_INTERACTION_RETRY_BASE_MS * 2 ** (AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD - 1);
const LOCAL_NOTICE_AFTER_MS = LOCAL_RETRY_AFTER_NOTICE_MS - AGENT_INTERACTION_RETRY_BASE_MS;
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

function unreachableGateway(): FakeAgentInteractionGateway {
  const gateway = new FakeAgentInteractionGateway();
  gateway.readable = false;
  gateway.list.mockImplementation(() => Promise.reject(new Error("The runner is unreachable.")));
  return gateway;
}

function questionOnlyGateway(): AgentQuestionGateway & AgentInteractionFeed {
  const gateway = listingGateway([QUESTION], []);
  return {
    list: gateway.list,
    answer: gateway.answer,
    currentInteractions: gateway.currentInteractions,
    subscribeInteractions: gateway.subscribeInteractions,
  };
}

function listingGateway(
  questions: readonly AgentQuestionRequest[],
  approvals: readonly AgentApprovalRequest[],
): FakeAgentInteractionGateway {
  const gateway = new FakeAgentInteractionGateway();
  gateway.list.mockImplementation(() => Promise.resolve(structuredClone(questions)));
  gateway.stage(LOCAL_FEED_OWNER, { questions, approvals });
  return gateway;
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

  async function elapse(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  function pushLocal(
    gateway: FakeAgentInteractionGateway,
    questions: readonly AgentQuestionRequest[],
    approvals: readonly AgentApprovalRequest[],
  ): void {
    act(() => gateway.push(LOCAL_FEED_OWNER, { questions, approvals }));
  }

  function noticeText(): string | null {
    const latest = published[published.length - 1];
    return latest?.kind === "notice" ? latest.text : null;
  }

  it("shows the reconnecting notice once for a remote turn whose polls keep failing", async () => {
    vi.useFakeTimers();
    const gateway = unreachableGateway();
    mount(gateway, REMOTE_OWNER);

    await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 1);
    const noticed = published.length;
    await polls(4);

    expectShown("notice");
    expect(noticeText()).toBe("Questions could not be refreshed. Reconnecting…");
    expect(published).toHaveLength(noticed);
    expect(gateway.currentInteractions).not.toHaveBeenCalled();
  });

  it("shows no reconnecting notice for a remote turn after a single failed poll", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([], []);
    gateway.list.mockImplementationOnce(() => Promise.reject(new Error("blip")));
    mount(gateway, REMOTE_OWNER);

    await firstPoll();
    await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 1);

    expectShown("none");
    expect(publishedKinds()).toEqual(["none"]);
  });

  it("shows one unavailable notice, never the reconnecting one, once a local turn's reads keep failing", async () => {
    vi.useFakeTimers();
    const gateway = unreachableGateway();
    mount(gateway, LOCAL_OWNER);

    await firstPoll();
    expectShown("none");
    await elapse(LOCAL_NOTICE_AFTER_MS - 1);
    expectShown("none");
    expect(publishedKinds()).toEqual(["none"]);

    await elapse(1);
    expectShown("notice");
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(
      AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD,
    );
    const noticed = published.length;
    await elapse(3 * AGENT_INTERACTION_RETRY_CAP_MS);

    expectShown("notice");
    expect(noticeText()).not.toBeNull();
    expect(noticeText()).not.toContain("Reconnecting");
    expect(published).toHaveLength(noticed);
    expect(publishedKinds()).toEqual(["none", "notice"]);
    expect(gateway.currentInteractions.mock.calls.length).toBeGreaterThan(
      AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD,
    );
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("drops a local turn's unavailable notice as soon as its interactions can be read again", async () => {
    vi.useFakeTimers();
    const gateway = unreachableGateway();
    mount(gateway, LOCAL_OWNER);
    await firstPoll();
    await elapse(LOCAL_NOTICE_AFTER_MS);
    expectShown("notice");

    gateway.readable = true;
    gateway.stage(LOCAL_FEED_OWNER, { questions: [QUESTION] });
    await elapse(LOCAL_RETRY_AFTER_NOTICE_MS - 1);
    expectShown("notice");
    await elapse(1);

    expectShown("question");
    expect(publishedKinds()).toEqual(["none", "notice", "question"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { name: "once", failures: 1 },
    {
      name: "one time short of the notice threshold",
      failures: AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD - 1,
    },
  ])(
    "never shows a notice for a local turn whose read fails $name and then succeeds",
    async ({ failures }) => {
      vi.useFakeTimers();
      const gateway = listingGateway([QUESTION], []);
      for (let failure = 0; failure < failures; failure += 1) {
        gateway.currentInteractions.mockImplementationOnce(() =>
          Promise.reject(new Error("Agent interactions are unavailable.")),
        );
      }
      mount(gateway, LOCAL_OWNER);

      await firstPoll();
      expectShown("none");
      await elapse(LOCAL_NOTICE_AFTER_MS);
      expectShown("question");
      await elapse(3 * AGENT_INTERACTION_RETRY_CAP_MS);

      expectShown("question");
      expect(publishedKinds()).toEqual(["none", "question"]);
      expect(gateway.currentInteractions).toHaveBeenCalledTimes(failures + 1);
      expect(gateway.list).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("shows no notice for a local turn whose interactions stay readable", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([], []);
    gateway.list.mockImplementation(() => Promise.reject(new Error("The runner is unreachable.")));
    mount(gateway, LOCAL_OWNER);

    await firstPoll();
    await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 2);

    expectShown("none");
    expect(publishedKinds()).toEqual(["none"]);
    expect(gateway.list).not.toHaveBeenCalled();
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a pending question of a remote turn", async () => {
    mount(listingGateway([QUESTION], []), REMOTE_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending question of a local turn when the gateway answers no approvals", async () => {
    mount(questionOnlyGateway(), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending question of a local turn when the gateway also answers approvals", async () => {
    mount(listingGateway([QUESTION], []), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("question");
  });

  it("shows a pending approval of a local turn", async () => {
    mount(listingGateway([], [APPROVAL]), LOCAL_OWNER);

    await interactionOrCrash();

    expectShown("approval");
  });

  it("hands the parent a remote turn's question once while polls keep listing it", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([QUESTION], []);
    mount(gateway, REMOTE_OWNER);

    await firstPoll();
    await polls(5);

    expectShown("question");
    expect(gateway.list).toHaveBeenCalledTimes(6);
    expect(gateway.currentInteractions).not.toHaveBeenCalled();
    expect(publishedKinds()).toEqual(["none", "question"]);
  });

  it("hands the parent a local turn's question once while the feed keeps pushing it", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([QUESTION], []);
    mount(gateway, LOCAL_OWNER);

    await firstPoll();
    for (let round = 0; round < 5; round += 1) pushLocal(gateway, [QUESTION], []);
    await polls(5);

    expectShown("question");
    expect(gateway.list).not.toHaveBeenCalled();
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(publishedKinds()).toEqual(["none", "question"]);
  });

  it("hands the parent a local turn's approval once while the feed keeps pushing it", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([], [APPROVAL]);
    mount(gateway, LOCAL_OWNER);

    await firstPoll();
    for (let round = 0; round < 5; round += 1) pushLocal(gateway, [], [APPROVAL]);
    await polls(5);

    expectShown("approval");
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(publishedKinds()).toEqual(["none", "approval"]);
  });

  it("shows a local turn's question the moment it is pushed and clears it once it is gone", async () => {
    vi.useFakeTimers();
    const gateway = listingGateway([], []);
    mount(gateway, LOCAL_OWNER);
    await firstPoll();
    expectShown("none");

    pushLocal(gateway, [QUESTION], []);
    expectShown("question");

    pushLocal(gateway, [], []);
    expectShown("none");
    expect(publishedKinds()).toEqual(["none", "question", "none"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands the parent a new interaction when the pushed question changes", async () => {
    vi.useFakeTimers();
    const reworded: AgentQuestionRequest = {
      ...QUESTION,
      questions: [{ ...QUESTION.questions[0]!, prompt: "Which theme?" }],
    };
    const gateway = listingGateway([QUESTION], []);
    mount(gateway, LOCAL_OWNER);
    await firstPoll();

    pushLocal(gateway, [reworded], []);

    const latest = published[published.length - 1];
    expectShown("question");
    expect(publishedKinds()).toEqual(["none", "question", "question"]);
    expect(latest?.kind === "question" ? latest.request : null).toEqual(reworded);
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
    expect(gateway.currentInteractions).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(publishedKinds()).toEqual(["none", "question"]);

    mount(gateway, REMOTE_OWNER, "available");
    await firstPoll();

    expect(gateway.list).toHaveBeenCalledTimes(2);
    expect(gateway.currentInteractions).not.toHaveBeenCalled();
    expect(publishedKinds()).toEqual(["none", "question"]);
  });

  it.each(OWNERS)(
    "shows no notice for a $name turn whose runner is known to be unreachable",
    async ({ owner }) => {
      vi.useFakeTimers();
      const gateway = unreachableGateway();
      mount(gateway, owner, "unreachable");

      await polls(AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 2);

      expectShown("none");
      expect(publishedKinds()).toEqual(["none"]);
      expect(gateway.list).not.toHaveBeenCalled();
      expect(gateway.currentInteractions).not.toHaveBeenCalled();
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
