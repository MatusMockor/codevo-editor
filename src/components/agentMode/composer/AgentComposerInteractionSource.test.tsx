// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentRuntimeRequest } from "../../../domain/agentRuntimeRequest";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
  type AgentThreadRequestFeedFake,
} from "../../../test/agentThreadRequestFeedFake";
import { waitForReact } from "../../../test/reactTestLifecycle";
import {
  COMPOSER_REQUEST_TURN as TURN,
  COMPOSER_REQUEST_WORKSPACE as WORKSPACE,
  localAnswerGatewayFake,
  localComposerThread,
} from "../agentComposerRequestTestFixtures";
import { AgentThreadRequestFeedContext } from "../agentThreadRequestFeedContext";
import { AgentThreadRequestsScope } from "../AgentThreadRequestsScope";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const THREAD = "agt-thread-0001";
const SCOPE = { threadId: THREAD, workspaceId: WORKSPACE };

function approval(overrides: Record<string, unknown> = {}): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingApproval", { turnId: TURN, ...overrides });
}

describe("AgentComposerInteractionSource held in parent state", () => {
  let host: HTMLDivElement;
  let root: Root;
  let feed: AgentThreadRequestFeedFake;
  let published: Array<AgentComposerInteraction | null>;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    feed = agentThreadRequestFeedFake();
    published = [];
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(consoleError).not.toHaveBeenCalled();
    host.remove();
    vi.restoreAllMocks();
  });

  function Parent({ sourceThreadId }: { readonly sourceThreadId: string }) {
    const [interaction, setInteraction] = useState<AgentComposerInteraction | null>(null);
    const publish = useCallback((next: AgentComposerInteraction | null) => {
      published.push(next);
      setInteraction(next);
    }, []);
    return (
      <>
        <AgentComposerInteractionSource
          gateway={localAnswerGatewayFake()}
          onChange={publish}
          threadId={sourceThreadId}
        />
        <output>{interaction?.key ?? "none"}</output>
      </>
    );
  }

  function render(thread: AgentThreadView, sourceThreadId = thread.thread.threadId): void {
    act(() =>
      root.render(
        <AgentThreadRequestFeedContext.Provider value={feed}>
          <AgentThreadRequestsScope thread={thread}>
            <Parent sourceThreadId={sourceThreadId} />
          </AgentThreadRequestsScope>
        </AgentThreadRequestFeedContext.Provider>,
      ),
    );
  }

  function shown(): string | null {
    return host.querySelector("output")?.textContent ?? null;
  }

  it("publishes the thread's pending approval and clears it on unmount", async () => {
    feed.record(agentThreadRequestsOf(SCOPE, [approval()]));
    render(localComposerThread());
    await waitForReact(() => expect(shown()).toBe(`approval:${TURN}:req-0002`));

    act(() => root.render(<></>));

    expect(published[published.length - 1]).toBeNull();
  });

  it("hands the parent one interaction while the feed keeps pushing the same record", async () => {
    render(localComposerThread());
    await waitForReact(() => expect(feed.currentThreadRequests).toHaveBeenCalled());
    const record = approval();
    act(() => feed.publish(agentThreadRequestsOf(SCOPE, [record])));
    await waitForReact(() => expect(shown()).toBe(`approval:${TURN}:req-0002`));
    const count = published.length;

    for (let push = 0; push < 5; push += 1)
      act(() => feed.publish(agentThreadRequestsOf(SCOPE, [record])));
    render(localComposerThread());
    await act(async () => Promise.resolve());

    expect(published.length).toBe(count);
  });

  it("hands the parent a new interaction when the pushed record changes", async () => {
    render(localComposerThread());
    act(() => feed.publish(agentThreadRequestsOf(SCOPE, [approval()])));
    await waitForReact(() => expect(shown()).toBe(`approval:${TURN}:req-0002`));
    const first = published[published.length - 1];

    act(() =>
      feed.publish(
        agentThreadRequestsOf(SCOPE, [
          approval({ version: 2, body: { ...approval().body, title: "Run the linter" } }),
        ]),
      ),
    );

    await waitForReact(() => {
      const latest = published[published.length - 1];
      expect(latest).not.toBe(first);
      expect(latest?.kind === "approval" && latest.view.title).toBe("Run the linter");
    });
  });

  it("publishes nothing for a thread that does not own the open request scope", async () => {
    feed.record(agentThreadRequestsOf(SCOPE, [approval()]));
    render(localComposerThread(), "agt-thread-other");
    await waitForReact(() => expect(feed.currentThreadRequests).toHaveBeenCalled());
    await act(async () => Promise.resolve());

    expect(shown()).toBe("none");
    expect(published.every((interaction) => interaction === null)).toBe(true);
  });
});
