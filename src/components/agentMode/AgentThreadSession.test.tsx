// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { GitChangedFile } from "../../domain/git";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadSession", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("invites a new thread when nothing is selected", () => {
    render({ thread: null });

    expect(host.textContent).toContain("Start a thread in app");
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("names the missing repository instead of inventing one", () => {
    render({ thread: null, composerRepositoryLabel: null });

    expect(host.textContent).toContain("No Git repository detected");
  });

  it("notes imported provenance above the first turn", () => {
    render({
      thread: threadView({
        externalOrigin: {
          provider: "claudeCode",
          sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
          importedAtEpochMs: NOW - 60_000,
        },
      }),
    });

    const note = host.querySelector(".agent-session__provenance");
    expect(note?.textContent).toBe(
      "Imported from terminal session 987b95ad-c9bc-4d08-ae49-9b431efc8f87",
    );

    const firstTurn = host.querySelector("article.agent-turn");
    expect(firstTurn).not.toBeNull();
    expect(
      note !== null &&
        firstTurn !== null &&
        (note.compareDocumentPosition(firstTurn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  it("renders no provenance note for a native thread", () => {
    render({});

    expect(host.querySelector(".agent-session__provenance")).toBeNull();
  });

  it("renders imported user and assistant messages before local turns without duplicating them", () => {
    const props = { thread: threadView({ externalOrigin: importedOrigin() }) };
    render(props);
    render(props);

    const history = host.querySelector('section[aria-label="Original conversation"]');
    expect(history?.querySelectorAll("article")).toHaveLength(2);
    expect(history?.querySelector(".agent-prompt__body")?.textContent).toBe("Original question");
    expect(history?.querySelector(".agent-text__paragraph")?.textContent).toBe("Original answer");
    expect(host.querySelectorAll("article.agent-turn")).toHaveLength(1);
    expect(host.textContent?.indexOf("Original answer")).toBeLessThan(
      host.textContent?.indexOf("Refactor the parser") ?? 0,
    );
    expect(history?.querySelector(".agent-prompt__meta")?.textContent).toBe("");
    expect(history?.querySelector(".agent-work")).toBeNull();
  });

  it("copies original messages using the same clipboard controls as local messages", async () => {
    const writeText = vi.fn(async () => undefined);
    render({
      thread: threadView({ externalOrigin: importedOrigin(), turns: [] }),
      textClipboard: { canWriteText: () => true, writeText },
    });

    await act(async () => button("Copy your message").click());
    expect(writeText).toHaveBeenLastCalledWith("Original question");
    await act(async () => button("Copy AI response").click());
    expect(writeText).toHaveBeenLastCalledWith("Original answer");
  });

  it("states when original history has omitted messages or text", () => {
    render({ thread: threadView({ externalOrigin: importedOrigin(true), turns: [] }) });

    expect(host.textContent).toContain("Only part of the original conversation is available.");
    expect(host.textContent).toContain("Some messages or message text were omitted.");
    expect(host.textContent).not.toContain("Earlier turns were dropped");
  });

  it("shows history loading and allows retry after a failure", () => {
    const onRetryExternalHistory = vi.fn();
    const thread = threadView({
      externalOrigin: { ...importedOrigin(), history: undefined },
      turns: [],
    });
    render({ thread, externalHistoryState: "loading", onRetryExternalHistory });
    expect(host.textContent).toContain("Loading original conversation…");
    expect(host.querySelector("button")).toBeNull();

    render({ thread, externalHistoryState: "failed", onRetryExternalHistory });
    expect(host.textContent).toContain("Could not load the original conversation.");
    clickText("Retry loading history");
    expect(onRetryExternalHistory).toHaveBeenCalledOnce();

    render({ thread, externalHistoryState: "unavailable", onRetryExternalHistory });
    expect(host.textContent).toContain("Original conversation history is unavailable.");
  });

  it("keeps persisted history visible even if a refresh is unavailable", () => {
    render({
      thread: threadView({ externalOrigin: importedOrigin(), turns: [] }),
      externalHistoryState: "failed",
    });

    expect(host.textContent).toContain("Original answer");
    expect(host.textContent).not.toContain("Could not load");
  });

  it("scrolls to the latest message after original history hydrates", () => {
    render({
      thread: threadView({
        externalOrigin: { ...importedOrigin(), history: undefined },
        turns: [],
      }),
      externalHistoryState: "loading",
    });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    render({
      thread: threadView({ externalOrigin: importedOrigin(), turns: [] }),
      externalHistoryState: "ready",
    });

    expect(scroll.scrollTop).toBe(900);
  });

  it("renders one turn per prompt with its assistant paragraphs", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "First paragraph.\n\nSecond paragraph." },
          ]),
          turn("agt-1-t2", "Also update the tests", { kind: "running" }, [
            { kind: "assistantText", text: "Working on it." },
          ]),
        ],
      }),
    });

    expect(host.querySelectorAll("article.agent-turn")).toHaveLength(2);
    expect(host.querySelectorAll(".agent-prompt__body")[1]?.textContent).toBe(
      "Also update the tests",
    );
    expect(
      [...host.querySelectorAll(".agent-text__paragraph")].map((element) => element.textContent),
    ).toEqual(["First paragraph.", "Second paragraph.", "Working on it."]);
  });

  it("copies the exact user message and AI response with success feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    const textClipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
    render({
      textClipboard,
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Keep\nmy prompt", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "First paragraph.\n\n\nSecond paragraph." },
          ]),
        ],
      }),
    });

    const promptCopy = button("Copy your message");
    const responseCopy = button("Copy AI response");

    await act(async () => promptCopy.click());
    expect(writeText).toHaveBeenLastCalledWith("Keep\nmy prompt");
    expect(promptCopy.getAttribute("aria-label")).toBe("Copied your message");

    await act(async () => responseCopy.click());
    expect(writeText).toHaveBeenLastCalledWith("First paragraph.\n\n\nSecond paragraph.");
    expect(responseCopy.getAttribute("aria-label")).toBe("Copied AI response");
  });

  it("keeps clipboard feedback working after StrictMode replays its effects", async () => {
    const writeText = vi.fn(async () => undefined);
    act(() =>
      root.render(
        <StrictMode>
          <AgentClockProvider nowTickMs={1}>
            <AgentThreadSession
              {...defaultProps()}
              textClipboard={{ canWriteText: () => true, writeText }}
            />
          </AgentClockProvider>
        </StrictMode>,
      ),
    );

    const copy = button("Copy your message");
    await act(async () => copy.click());

    expect(writeText).toHaveBeenCalledExactlyOnceWith("Refactor the parser");
    expect(copy.getAttribute("aria-label")).toBe("Copied your message");
  });

  it("reports a rejected clipboard write and lets the user retry", async () => {
    const writeText = vi
      .fn<TextClipboardGateway["writeText"]>()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    render({ textClipboard: { canWriteText: () => true, writeText } });

    const copy = button("Copy your message");
    await act(async () => copy.click());
    expect(copy.getAttribute("aria-label")).toBe("Could not copy your message");

    await act(async () => copy.click());
    expect(copy.getAttribute("aria-label")).toBe("Copied your message");
  });

  it("copies a distinct final AI result", async () => {
    const writeText = vi.fn(async () => undefined);
    render({
      textClipboard: { canWriteText: () => true, writeText },
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Run it", { kind: "exited", exitCode: 0 }, [
            { kind: "result", text: "Final result", isError: false, usage: null },
          ]),
        ],
      }),
    });

    await act(async () => button("Copy AI response").click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Final result");
  });

  it("pairs a tool call with the result of the same tool id", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "toolCall", toolId: "t-1", name: "Read", inputSummary: "src/parser.ts" },
            { kind: "toolCall", toolId: "t-2", name: "Bash", inputSummary: "npm test" },
            { kind: "toolResult", toolId: "t-1", outputSummary: "42 lines", isError: false },
            { kind: "toolResult", toolId: "t-2", outputSummary: "exit 1", isError: true },
          ]),
        ],
      }),
    });

    const rows = [...host.querySelectorAll(".agent-tool")];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Read");
    expect(rows[0]?.textContent).toContain("src/parser.ts");
    expect(rows[0]?.querySelector(".agent-tool__status--ok")).not.toBeNull();
    expect(rows[1]?.querySelector(".agent-tool__status--bad")).not.toBeNull();
  });

  it("keeps a tool call without a result visible as running", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
          ]),
        ],
      }),
    });

    expect(host.querySelector(".agent-tool__status")?.textContent).toBe("running");
    expect(host.querySelector(".agent-tool__status--ok")).toBeNull();
  });

  it("shows how many subagents were started and their live outcomes", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Audit the UI", { kind: "running" }, [
            { kind: "toolCall", toolId: "agent-1", name: "Task", inputSummary: "Review" },
            { kind: "toolCall", toolId: "agent-2", name: "Agent", inputSummary: "Test" },
            { kind: "toolResult", toolId: "agent-1", outputSummary: "done", isError: false },
          ]),
        ],
      }),
    });

    expect(host.querySelector(".agent-subagents")?.textContent).toBe(
      "Started 2 subagents1 working · 1 completed",
    );
    expect(host.querySelector(".agent-subagents__dot--live")).not.toBeNull();
  });

  it("collapses reasoning and raw output instead of dumping them", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "reasoning", text: "Considering the grammar." },
            { kind: "unknownLine", stream: "stderr", raw: "npm warn deprecated", clipped: false },
          ]),
        ],
      }),
    });

    const reasoning = host.querySelector("details.agent-reasoning");
    const raw = host.querySelector("details.agent-raw");

    expect(reasoning?.querySelector("summary")?.textContent).toBe("reasoning");
    expect((reasoning as HTMLDetailsElement | null)?.open).toBe(false);
    expect(raw?.querySelector("summary")?.textContent).toBe("raw output");
    expect(raw?.textContent).toContain("npm warn deprecated");
  });

  it("renders the result as a finale and an error as a bad finale", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "error", message: "The MCP server refused the token." },
            { kind: "result", text: "Done in 4 files.", isError: false, usage: null },
          ]),
        ],
      }),
    });

    expect(host.textContent).toContain("Done in 4 files.");
    expect(host.textContent).toContain("The MCP server refused the token.");
    expect(host.querySelectorAll(".agent-finale--bad")).toHaveLength(1);
  });

  it("renders only the last rendered-events window and counts the hidden ones", () => {
    const events: AgentTurnEvent[] = Array.from(
      { length: MAX_RENDERED_EVENTS_PER_TURN + 7 },
      (_unused, index) => ({ kind: "assistantText", text: `line ${index}` }),
    );
    render({
      thread: threadView({
        turns: [turn("agt-1-t1", "Refactor the parser", { kind: "running" }, events)],
      }),
    });

    expect(host.querySelectorAll(".agent-text")).toHaveLength(MAX_RENDERED_EVENTS_PER_TURN);
    expect(host.textContent).toContain("7 earlier events hidden");
    expect(host.querySelector(".agent-text__paragraph")?.textContent).toBe("line 7");
  });

  it("reports a bounded turn instead of pretending the output is complete", () => {
    render({
      thread: threadView({
        turns: [
          {
            ...turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, []),
            eventsTruncated: true,
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Later output was dropped to bound memory.");
  });

  it("says when a turn was interrupted by an app restart", () => {
    render({
      thread: threadView({
        turns: [turn("agt-1-t1", "Refactor the parser", { kind: "interrupted" }, [])],
      }),
    });

    expect(host.textContent).toContain("Interrupted by app restart");
  });

  it("waits for output without pretending the stream is empty", () => {
    render({ thread: threadView({ status: { kind: "pending" } }) });

    expect(host.textContent).toContain("Waiting for output…");
  });

  it("scrolls to the latest message when a new turn starts", () => {
    const first = turn("agt-1-t1", "First", { kind: "exited", exitCode: 0 }, []);
    render({ thread: threadView({ turns: [first] }) });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 120 });

    const next = threadView({
      turns: [first, turn("agt-1-t2", "Second", { kind: "running" }, [])],
    });
    render({ thread: next });

    expect(scroll.scrollTop).toBe(900);
  });

  it("keeps following streamed output while already at the bottom", () => {
    const running = turn("agt-1-t1", "First", { kind: "running" }, []);
    render({ thread: threadView({ turns: [running] }) });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
    act(() => scroll.dispatchEvent(new Event("scroll")));

    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "First", { kind: "running" }, [
            { kind: "assistantText", text: "Working" },
          ]),
        ],
      }),
    });

    expect(scroll.scrollTop).toBe(900);
  });

  it("does not pull the reader away from older output during the same turn", () => {
    const running = turn("agt-1-t1", "First", { kind: "running" }, []);
    render({ thread: threadView({ turns: [running] }) });
    const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
    act(() => scroll.dispatchEvent(new Event("scroll")));

    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "First", { kind: "running" }, [
            { kind: "assistantText", text: "Working" },
          ]),
        ],
      }),
    });

    expect(scroll.scrollTop).toBe(100);
  });

  it("renders the failure message of a failed turn", () => {
    render({
      thread: threadView({ status: { kind: "failed", message: "Agent CLI exited with code 1." } }),
    });

    expect(host.textContent).toContain("Agent CLI exited with code 1.");
  });

  it("shows only the message time below a user bubble", () => {
    render({
      thread: threadView({
        turns: [
          {
            ...turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [], {
              provider: "claudeCode",
              model: "opus",
              mode: "acceptEdits",
              effort: "default",
            }),
            cliVersion: "2.1.245",
          },
        ],
      }),
    });

    const meta = host.querySelector(".agent-prompt__meta");

    expect(meta?.textContent).toBe("5 minutes ago");
    expect(meta?.getAttribute("aria-label")).toBe("Message time");
    expect(host.textContent).not.toContain("worktree");
    expect(host.textContent).not.toContain("finished");
    expect(host.textContent).not.toContain("opus");
    expect(host.textContent).not.toContain("accept edits");
    expect(host.textContent).not.toContain("claude 2.1.245");
  });

  it("does not add launch choices to historical user messages", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Use low effort", { kind: "exited", exitCode: 0 }, [], {
            provider: "claudeCode",
            model: "sonnet",
            mode: "plan",
            effort: "low",
          }),
          turn("agt-1-t2", "Use configured effort", { kind: "exited", exitCode: 0 }, [], {
            provider: "claudeCode",
            model: "opus",
            mode: "acceptEdits",
            effort: "default",
          }),
          turn("agt-1-t3", "Use Codex", { kind: "exited", exitCode: 0 }, [], {
            provider: "codex",
            model: "gpt-5.5",
            mode: "readOnly",
          }),
        ],
      }),
    });

    expect(host.querySelectorAll(".agent-prompt__meta")).toHaveLength(3);
    expect(host.querySelector(".agent-prompt__launch")).toBeNull();
    expect(host.textContent).not.toContain("sonnet");
    expect(host.textContent).not.toContain("gpt-5.5");
  });

  it("does not badge permission modes inside the conversation", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Plan it", { kind: "exited", exitCode: 0 }, [], {
            provider: "claudeCode",
            model: "opus",
            mode: "plan",
            effort: "default",
          }),
          turn("agt-1-t2", "Do it", { kind: "exited", exitCode: 0 }, [], {
            provider: "codex",
            model: "gpt-5.5",
            mode: "dangerFullAccess",
          }),
        ],
      }),
    });

    expect(host.textContent).not.toContain("plan only");
    expect(host.textContent).not.toContain("full access");
  });

  it("shows no launch meta for a turn recorded before launch options existed", () => {
    render({ thread: threadView({}) });

    expect(host.querySelector(".agent-prompt__launch")).toBeNull();
    expect(host.querySelector(".agent-prompt__cli")).toBeNull();
  });

  it("keeps the CLI version out of the conversation transcript", () => {
    render({
      thread: threadView({
        turns: [
          {
            ...turn("agt-1-t1", "Plan it", { kind: "exited", exitCode: 0 }, []),
            cliVersion: "2.1.245",
          },
          turn("agt-1-t2", "Do it", { kind: "exited", exitCode: 0 }, []),
        ],
      }),
    });

    expect(host.querySelector(".agent-prompt__cli")).toBeNull();
    expect(host.textContent).not.toContain("claude 2.1.245");
  });

  it("distinguishes a retained local branch from a deleted local branch and retained remote", () => {
    render({ thread: threadView({ worktreeRemoved: true }) });

    expect(host.textContent).toContain("The worktree was removed. Its local branch was kept.");

    render({
      thread: threadView({
        branchDeleted: true,
        pushed: { remote: "origin", branch: "agent/agt-1" },
      }),
    });

    expect(host.textContent).toContain(
      "The worktree and its local branch were removed. The remote branch was kept.",
    );

    render({ thread: threadView({ branchDeleted: true }) });

    expect(host.textContent).toContain("The worktree and its local branch were removed.");
    expect(host.textContent).not.toContain("The remote branch was kept.");
  });

  it("tells the user when the worktree disappeared", () => {
    render({ thread: threadView({ worktreeMissing: true }) });

    expect(host.textContent).toContain("The worktree for this thread no longer exists.");
  });

  it("reports dropped turns instead of hiding them", () => {
    render({ thread: threadView({ turnsTruncated: true }) });

    expect(host.textContent).toContain("Earlier turns were dropped to bound memory.");
  });

  it("replaces the inline change list with a single review cue that opens the Diff surface", () => {
    const onReviewInDiff = vi.fn();
    render({
      onReviewInDiff,
      thread: threadView({
        changeSummary: summary({ files: [changedFile("src/a.ts"), changedFile("src/b.ts")] }),
      }),
    });

    expect(host.querySelector(".agent-session__head")).toBeNull();
    expect(host.querySelector('section[aria-label="Ship agent agt-1"]')).toBeNull();
    expect(host.querySelector(".agent-changes")).toBeNull();
    expect(host.querySelector("[data-agent-changes-cue]")?.textContent).toContain(
      "2 files changed",
    );
    clickText("Review in Diff");

    expect(onReviewInDiff).toHaveBeenCalledWith("agt-1");
  });

  it("re-renders no turn body when only the clock ticks", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = threadView({
      turns: [
        turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, []),
        turn("agt-1-t2", "Also update the tests", { kind: "running" }, []),
      ],
    });
    render({ thread: view, turnRenderProbe: probe });

    expect(renders).toHaveLength(2);

    for (let tick = 1; tick <= 500; tick += 1) {
      act(() => {
        vi.setSystemTime(NOW + tick * 100);
        vi.advanceTimersByTime(1);
      });
    }

    expect(renders).toHaveLength(2);
  });

  it("re-renders only the turn whose output changed while chunks stream in", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const settled = Array.from({ length: 5 }, (_unused, index) =>
      turn(`agt-1-s${index}`, "Settled", { kind: "exited", exitCode: 0 }, []),
    );
    const events: AgentTurnEvent[] = [];
    const running = (): AgentTurn => ({
      ...turn("agt-1-run", "Refactor the parser", { kind: "running" }, [...events]),
    });
    render({ thread: threadView({ turns: [...settled, running()] }), turnRenderProbe: probe });

    expect(renders).toHaveLength(6);
    renders.length = 0;

    for (let chunk = 0; chunk < 200; chunk += 1) {
      events.push({ kind: "assistantText", text: `chunk ${chunk}` });
      render({ thread: threadView({ turns: [...settled, running()] }), turnRenderProbe: probe });
    }

    expect(renders.filter((turnId) => turnId !== "agt-1-run")).toEqual([]);
    expect(renders).toHaveLength(200);
  });

  it("marks every find hit in the prompt and the assistant text", () => {
    render(withFind({ findHitIndex: 0 }));

    expect(
      [...host.querySelectorAll("mark.agent-find__hit")].map((node) => node.textContent),
    ).toEqual(["parser", "parser", "parser", "parser"]);
  });

  it("marks only the current hit as current", () => {
    render(withFind({ findHitIndex: 1 }));

    const current = host.querySelectorAll("mark.agent-find__hit--current");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-hit-index")).toBe("1");
    expect(current[0]?.closest("[data-agent-turn]")?.getAttribute("data-agent-turn")).toBe(
      "agt-1-t1",
    );
  });

  it("moves the current mark into the assistant paragraph that owns the hit", () => {
    render(withFind({ findHitIndex: 2 }));

    const current = host.querySelector("mark.agent-find__hit--current");
    expect(current?.closest("[data-agent-event]")?.getAttribute("data-agent-event")).toBe("e0");
    expect(current?.getAttribute("data-hit-index")).toBe("0");
  });

  it("scrolls the current hit into view", () => {
    const scrolled = stubScrollIntoView();

    render(withFind({ findHitIndex: 3 }));

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).className).toContain("agent-find__hit--current");
  });

  it("never highlights a query below the searchable minimum", () => {
    render(withFind({ findQuery: "p", findHitIndex: 0 }));

    expect(host.querySelectorAll("mark.agent-find__hit")).toHaveLength(0);
    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe("parser and parser");
  });

  it("reveals a turn whose events were dropped from the rendered projection", () => {
    const scrolled = stubScrollIntoView();
    const events: AgentTurnEvent[] = Array.from(
      { length: MAX_RENDERED_EVENTS_PER_TURN + 4 },
      (_unused, index) => ({ kind: "assistantText", text: `chunk ${index}` }),
    );

    render({
      thread: threadView({
        turnsTruncated: true,
        turns: [turn("agt-1-t9", "Refactor the parser", { kind: "exited", exitCode: 0 }, events)],
      }),
      reveal: reveal({ turnId: "agt-1-t9", eventIndex: 0 }),
    });

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).getAttribute("data-agent-turn")).toBe("agt-1-t9");
  });

  it("scrolls the exact event of a reveal when it is rendered", () => {
    const scrolled = stubScrollIntoView();

    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "First." },
            { kind: "assistantText", text: "Second." },
          ]),
        ],
      }),
      reveal: reveal({ turnId: "agt-1-t1", eventIndex: 1 }),
    });

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).getAttribute("data-agent-event")).toBe("e1");
  });

  it("ignores a reveal for a turn that is no longer in the thread", () => {
    const scrolled = stubScrollIntoView();

    render({ reveal: reveal({ turnId: "agt-1-gone", eventIndex: null }) });

    expect(scrolled).toHaveLength(0);
  });

  it("re-renders only the turns whose highlight changed when the current hit moves", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = findThreadView();

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 0,
    });
    expect(renders).toHaveLength(2);
    renders.length = 0;

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 1,
    });
    expect(renders).toEqual(["agt-1-t1"]);
    renders.length = 0;

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 3,
    });
    expect(renders.slice().sort()).toEqual(["agt-1-t1", "agt-1-t2"]);
  });

  it("leaves every turn untouched while no query is active", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = findThreadView();

    render({ thread: view, turnRenderProbe: probe });
    renders.length = 0;

    render({ thread: view, turnRenderProbe: probe });

    expect(renders).toEqual([]);
  });

  function stubScrollIntoView(): Element[] {
    const scrolled: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    return scrolled;
  }

  function scrollContainer(dimensions: {
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly scrollTop: number;
  }): HTMLDivElement {
    const scroll = host.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: dimensions.scrollHeight },
      clientHeight: { configurable: true, value: dimensions.clientHeight },
      scrollTop: { configurable: true, value: dimensions.scrollTop, writable: true },
    });
    return scroll!;
  }

  function withFind(overrides: Partial<AgentThreadSessionProps>): Partial<AgentThreadSessionProps> {
    return {
      thread: findThreadView(),
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      ...overrides,
    };
  }

  function render(overrides: Partial<AgentThreadSessionProps> = {}): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession {...defaultProps()} {...overrides} />
        </AgentClockProvider>,
      ),
    );
  }

  function clickText(text: string): void {
    const element = [...host.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
    expect(element).toBeDefined();
    act(() => element?.click());
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
  }
});

function defaultProps(): AgentThreadSessionProps {
  return {
    thread: threadView({}),
    composerRepositoryLabel: "app",
    onReviewInDiff: () => undefined,
  };
}

function importedOrigin(exchangesTruncated = false): NonNullable<AgentThread["externalOrigin"]> {
  const provider = "claudeCode";
  const sessionId = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
  return {
    provider,
    sessionId,
    importedAtEpochMs: NOW - 60_000,
    history: {
      provider,
      sessionId,
      exchanges: [
        { role: "user", text: "Original question" },
        { role: "assistant", text: "Original answer" },
      ],
      exchangesTruncated,
      totalPreviewBytes: 32,
    },
  };
}

interface ThreadViewOptions {
  readonly status?: AgentTurnStatus;
  readonly turns?: ReadonlyArray<AgentTurn>;
  readonly externalOrigin?: AgentThread["externalOrigin"];
  readonly turnsTruncated?: boolean;
  readonly worktreeRemoved?: boolean;
  readonly worktreeMissing?: boolean;
  readonly branchDeleted?: boolean;
  readonly pushed?: { readonly remote: string; readonly branch: string } | null;
  readonly changeSummary?: AgentTaskChangeSummary | null;
}

function threadView(overrides: ThreadViewOptions): AgentThreadView {
  const status = overrides.status ?? { kind: "exited", exitCode: 0 };
  const turns = overrides.turns ?? [turn("agt-1-t1", "Refactor the parser", status, [])];
  const last = turns[turns.length - 1];
  const running = last?.status.kind === "pending" || last?.status.kind === "running";
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000,
    turns,
    turnsTruncated: overrides.turnsTruncated ?? false,
    viewedAtEpochMs: null,
    externalOrigin: overrides.externalOrigin ?? null,
    integration:
      overrides.branchDeleted === true || overrides.pushed !== undefined
        ? {
            lastCommitSha: null,
            pushed: overrides.pushed ?? null,
            integrated: null,
            branchDeleted: overrides.branchDeleted ?? false,
          }
        : null,
  };

  return {
    ship:
      overrides.branchDeleted === true
        ? { kind: "worktreeRemoved", branchDeleted: true }
        : { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: overrides.worktreeRemoved ?? false,
    worktreeMissing: overrides.worktreeMissing ?? false,
    changeSummary: overrides.changeSummary ?? null,
  };
}

function turn(
  turnId: string,
  prompt: string,
  status: AgentTurnStatus,
  events: ReadonlyArray<AgentTurnEvent>,
  launch: AgentLaunchOptions | null = null,
): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: NOW - 5 * 60_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch,
    cliVersion: null,
  };
}

function summary(overrides: Partial<AgentTaskChangeSummary>): AgentTaskChangeSummary {
  return {
    loading: false,
    error: null,
    files: [],
    truncated: false,
    removing: false,
    diff: null,
    ...overrides,
  };
}

function changedFile(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

const FIND_QUERY = "parser";

const FIND_HITS: ReadonlyArray<AgentThreadFindHit> = [
  { turnId: "agt-1-t1", eventIndex: null, start: 0, end: 6 },
  { turnId: "agt-1-t1", eventIndex: null, start: 11, end: 17 },
  { turnId: "agt-1-t1", eventIndex: 0, start: 4, end: 10 },
  { turnId: "agt-1-t2", eventIndex: null, start: 0, end: 6 },
];

const FIND_TURNS: ReadonlyArray<AgentTurn> = [
  turn("agt-1-t1", "parser and parser", { kind: "exited", exitCode: 0 }, [
    { kind: "assistantText", text: "the parser is ready.\n\nnothing else here." },
  ]),
  turn("agt-1-t2", "parser again", { kind: "exited", exitCode: 0 }, []),
];

let findThreadViewCache: AgentThreadView | null = null;

function findThreadView(): AgentThreadView {
  findThreadViewCache = findThreadViewCache ?? threadView({ turns: [...FIND_TURNS] });
  return findThreadViewCache;
}

function reveal(overrides: {
  readonly turnId: string;
  readonly eventIndex: number | null;
}): AgentThreadRevealRequest {
  return { query: FIND_QUERY, start: 0, end: 6, ...overrides };
}
