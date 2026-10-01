// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFollowUpRequest, AgentThreadView } from "../../application/agentThreadPorts";
import {
  RETRY_FAILED_MESSAGE,
  RETRY_NOT_STARTED_MESSAGE,
} from "../../application/useAgentTurnRetry";
import {
  createAgentComposerDraftStore,
  MAX_AGENT_COMPOSER_DRAFT_BYTES,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { waitForReact } from "../../test/reactTestLifecycle";
import type { AgentComposerProjectOption } from "./agentComposerTarget";
import {
  AgentThreadErrorBanner,
  NEW_THREAD_DRAFT_TOO_LARGE_MESSAGE,
  NEW_THREAD_HINT,
  RETRY_CONFIRM_DELAY_MS,
} from "./AgentThreadErrorBanner";
import { AGENT_COMPOSER_PROMPT_ID } from "./useAgentComposerState";
import { useAgentComposerRecovery } from "./useAgentComposerRecovery";

type SendFollowUp = (request: AgentFollowUpRequest) => Promise<boolean>;

const GUARDED_LAUNCH = {
  provider: "claudeCode",
  model: "default",
  mode: "acceptEdits",
} as unknown as AgentLaunchOptions;
const CLI_DEFAULT_LAUNCH = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
} as unknown as AgentLaunchOptions;

function failed(
  turnId: string,
  message = "boom",
  launch: AgentLaunchOptions | null = GUARDED_LAUNCH,
): AgentThreadView {
  return {
    thread: {
      threadId: "agt-1",
      archived: false,
      provider: { kind: "claudeCode", sessionId: null },
      owner: { rootKey: "/r", ownerId: "w", repositoryRoot: "/r" },
      turns: [
        {
          turnId,
          prompt: "Add idempotency",
          status: { kind: "failed", message },
          launch,
        },
      ],
    },
  } as unknown as AgentThreadView;
}

function surface(
  view: AgentThreadView,
  sendFollowUp: SendFollowUp,
  lastUsed: AgentLaunchOptions | null = null,
) {
  return { threads: [view], sendFollowUp, lastUsedLaunch: () => lastUsed };
}

const IMAGES_NOTICE =
  "API Error: an image in the conversation could not be processed and was removed. Re-read the file with a different approach if you still need it.";
const PROJECT: AgentComposerProjectOption = {
  projectRootKey: "/r",
  ownerId: "w",
  generation: 1,
  label: "orders",
  origin: "active-tab",
  rootPath: "/r",
  repositories: [{ repositoryRoot: "/r", label: "orders" }],
};

function imagesFailed(): AgentThreadView {
  const view = failed("t1");
  return {
    ...view,
    thread: {
      ...view.thread,
      turns: [
        {
          ...view.thread.turns[0]!,
          status: { kind: "exited", exitCode: 1 },
          events: [{ kind: "assistantText", text: IMAGES_NOTICE }],
        },
      ],
    },
  };
}

function RecoveringBanner(props: {
  readonly view: AgentThreadView;
  readonly drafts: AgentComposerDraftStore;
  readonly sendFollowUp: SendFollowUp;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  selectEnvironment(projectRootKey: string): void;
}) {
  const recovery = useAgentComposerRecovery({
    selectedThread: props.view,
    projects: [PROJECT],
    startNewThread: props.startNewThread,
    selectEnvironment: props.selectEnvironment,
  });
  return (
    <AgentThreadErrorBanner
      agents={surface(props.view, props.sendFollowUp)}
      drafts={props.drafts}
      recovery={recovery}
      view={props.view}
    />
  );
}

function newThreadButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Start new thread",
  );
}

function retryButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((button) =>
    /retry/i.test(button.textContent ?? ""),
  );
}

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
});

describe("AgentThreadErrorBanner", () => {
  it("retries the failed prompt and hides after dismiss until a new failure", async () => {
    const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
    const first = failed("t1");
    act(() =>
      root.render(<AgentThreadErrorBanner agents={surface(first, sendFollowUp)} view={first} />),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Claude Code could not complete this run.",
    );
    await act(async () => {
      retryButton()?.click();
    });
    expect(sendFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "agt-1", prompt: "Add idempotency" }),
    );
    expect(sendFollowUp.mock.calls[0]?.[0]).not.toHaveProperty("dangerousLaunchConfirmed");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]')?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const second = failed("t2");
    act(() =>
      root.render(<AgentThreadErrorBanner agents={surface(second, sendFollowUp)} view={second} />),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("shows Retrying and sends once when Retry is clicked twice", async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const sendFollowUp = vi.fn<SendFollowUp>(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const view = failed("t1");
    act(() =>
      root.render(<AgentThreadErrorBanner agents={surface(view, sendFollowUp)} view={view} />),
    );
    act(() => {
      retryButton()?.click();
      retryButton()?.click();
    });
    expect(retryButton()?.textContent).toContain("Retrying");
    expect(retryButton()?.disabled).toBe(true);
    await act(async () => {
      resolve(true);
    });
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
  });

  it("asks for an explicit confirmation before retrying a full access run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
      const view = failed("t1", "boom", CLI_DEFAULT_LAUNCH);
      act(() =>
        root.render(<AgentThreadErrorBanner agents={surface(view, sendFollowUp)} view={view} />),
      );
      expect(host.textContent).toContain("Retries with Full access");
      act(() => retryButton()?.click());
      expect(sendFollowUp).not.toHaveBeenCalled();
      expect(retryButton()?.textContent).toBe("Confirm retry with Full access");
      expect(retryButton()?.className).toContain("cv-button--danger");
      act(() => retryButton()?.click());
      expect(sendFollowUp).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(RETRY_CONFIRM_DELAY_MS));
      await act(async () => {
        retryButton()?.click();
      });
      expect(sendFollowUp).toHaveBeenCalledTimes(1);
      expect(sendFollowUp.mock.calls[0]?.[0]).toMatchObject({
        threadId: "agt-1",
        dangerousLaunchConfirmed: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the last used settings a retry falls back to", () => {
    const view = failed("t1", "boom", null);
    act(() =>
      root.render(
        <AgentThreadErrorBanner
          agents={surface(view, vi.fn<SendFollowUp>(), GUARDED_LAUNCH)}
          view={view}
        />,
      ),
    );
    expect(retryButton()?.disabled).toBe(false);
    expect(host.textContent).toContain("Retries with your last used settings:");
    expect(host.textContent).toContain("Auto-accept edits");
  });

  it("shows a visible error when the retry fails or does not start", async () => {
    const sendFollowUp = vi
      .fn<SendFollowUp>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValueOnce(false);
    const view = failed("t1");
    act(() =>
      root.render(<AgentThreadErrorBanner agents={surface(view, sendFollowUp)} view={view} />),
    );
    await act(async () => {
      retryButton()?.click();
    });
    expect(host.textContent).toContain(RETRY_FAILED_MESSAGE);
    await act(async () => {
      retryButton()?.click();
    });
    expect(host.textContent).toContain(RETRY_NOT_STARTED_MESSAGE);
    expect(host.textContent).not.toContain(RETRY_FAILED_MESSAGE);
  });

  it("disables Retry and says why when the run cannot be repeated", () => {
    const view = failed("t1");
    const withAttachment = {
      ...view,
      thread: {
        ...view.thread,
        turns: [
          {
            ...view.thread.turns[0]!,
            attachments: [{ kind: "reference", name: "a", path: "/a", bytes: 1 }],
          },
        ],
      },
    } as AgentThreadView;
    act(() =>
      root.render(
        <AgentThreadErrorBanner
          agents={surface(withAttachment, vi.fn<SendFollowUp>())}
          view={withAttachment}
        />,
      ),
    );
    expect(retryButton()?.disabled).toBe(true);
    expect(host.textContent).toContain("Send it again from the composer.");
  });

  it("starts a new thread in the same project and carries the composer draft", async () => {
    const drafts = createAgentComposerDraftStore();
    drafts.writeDraft("agt-1", "Compare the two dashboards");
    drafts.writeDraft("new:/r", "Earlier idea");
    const startNewThread = vi.fn();
    const selectEnvironment = vi.fn();
    const sendFollowUp = vi.fn<SendFollowUp>(async () => true);
    const view = imagesFailed();
    const prompt = document.createElement("textarea");
    prompt.id = AGENT_COMPOSER_PROMPT_ID;
    document.body.append(prompt);
    act(() =>
      root.render(
        <RecoveringBanner
          drafts={drafts}
          selectEnvironment={selectEnvironment}
          sendFollowUp={sendFollowUp}
          startNewThread={startNewThread}
          view={view}
        />,
      ),
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(NEW_THREAD_HINT);
    const hintId = newThreadButton()?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toBe(NEW_THREAD_HINT);
    expect(alert?.textContent).toContain(
      "This conversation contains images larger than the API allows.",
    );
    expect(alert?.textContent).toContain("Start a new thread to continue.");
    expect(retryButton()).toBeUndefined();
    await act(async () => {
      newThreadButton()?.click();
    });
    await waitForReact(() => expect(startNewThread).toHaveBeenCalledTimes(1));
    expect(startNewThread).toHaveBeenCalledWith("/r", "/r");
    expect(selectEnvironment).toHaveBeenCalledWith("/r");
    expect(drafts.readDraft("new:/r")).toBe("Earlier idea\n\nCompare the two dashboards");
    expect(drafts.readDraft("agt-1")).toBe("Compare the two dashboards");
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(prompt);
    prompt.remove();
  });

  it("keeps both drafts and explains when the combined draft is too large", async () => {
    const drafts = createAgentComposerDraftStore();
    const half = "x".repeat(MAX_AGENT_COMPOSER_DRAFT_BYTES / 2 + 1);
    drafts.writeDraft("agt-1", half);
    drafts.writeDraft("new:/r", half);
    const startNewThread = vi.fn();
    const view = imagesFailed();
    act(() =>
      root.render(
        <RecoveringBanner
          drafts={drafts}
          selectEnvironment={vi.fn()}
          sendFollowUp={vi.fn<SendFollowUp>()}
          startNewThread={startNewThread}
          view={view}
        />,
      ),
    );
    await act(async () => {
      newThreadButton()?.click();
    });
    expect(host.textContent).toContain(NEW_THREAD_DRAFT_TOO_LARGE_MESSAGE);
    expect(startNewThread).not.toHaveBeenCalled();
    expect(drafts.readDraft("new:/r")).toBe(half);
    expect(drafts.readDraft("agt-1")).toBe(half);
    const other = failed("t9");
    const otherView = { ...other, thread: { ...other.thread, threadId: "agt-2" } };
    for (const next of [otherView, view]) {
      act(() =>
        root.render(
          <RecoveringBanner
            drafts={drafts}
            selectEnvironment={vi.fn()}
            sendFollowUp={vi.fn<SendFollowUp>()}
            startNewThread={startNewThread}
            view={next}
          />,
        ),
      );
    }
    expect(host.textContent).not.toContain(NEW_THREAD_DRAFT_TOO_LARGE_MESSAGE);
  });

  it("never offers Retry and hides the action when no new thread can be started", () => {
    const view = imagesFailed();
    act(() =>
      root.render(
        <AgentThreadErrorBanner agents={surface(view, vi.fn<SendFollowUp>())} view={view} />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Start a new thread to continue.",
    );
    expect(retryButton()).toBeUndefined();
    expect(newThreadButton()).toBeUndefined();
  });

  it("renders nothing without a failed last turn", () => {
    act(() =>
      root.render(
        <AgentThreadErrorBanner
          agents={{ threads: [], sendFollowUp: vi.fn<SendFollowUp>(), lastUsedLaunch: () => null }}
          view={null}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
  });
});
