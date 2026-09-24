// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFollowUpRequest, AgentThreadView } from "../../application/agentThreadPorts";
import {
  RETRY_FAILED_MESSAGE,
  RETRY_NOT_STARTED_MESSAGE,
} from "../../application/useAgentTurnRetry";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentThreadErrorBanner, RETRY_CONFIRM_DELAY_MS } from "./AgentThreadErrorBanner";

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
