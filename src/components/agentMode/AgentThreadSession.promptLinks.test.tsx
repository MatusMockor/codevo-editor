// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { findInThread } from "../../domain/agentThreadSearch";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const MR = "https://git.efabrica.sk/ebox/backend/cms/-/merge_requests/5126";
const OWNER_PROMPT = `${MR} test napis len ahoj nic nepozeraj`;

describe("AgentThreadSession user message links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            onReviewInDiff={() => undefined}
            thread={null}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }

  function promptBody(): HTMLElement {
    const body = host.querySelector<HTMLElement>(".agent-prompt__bubble .agent-prompt__body");
    expect(body).not.toBeNull();
    return body as HTMLElement;
  }

  function click(target: Element | null | undefined, init: MouseEventInit = {}): MouseEvent {
    expect(target).toBeInstanceOf(HTMLAnchorElement);
    const event = new MouseEvent((init.button ?? 0) === 0 ? "click" : "auxclick", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      target?.dispatchEvent(event);
    });
    return event;
  }

  it("renders the owner's merge request URL as a link that opens through the opener port", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({ thread: view(OWNER_PROMPT), openExternalLink });

    const body = promptBody();
    const anchors = [...body.querySelectorAll<HTMLAnchorElement>("a")];
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor?.className).toBe("agent-prompt__link");
    expect(anchor?.getAttribute("href")).toBe(MR);
    expect(anchor?.getAttribute("title")).toBe(MR);
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.textContent).toBe(MR);
    expect(anchor?.tabIndex).toBe(0);
    expect(body.textContent).toBe(OWNER_PROMPT);

    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(MR);
  });

  it("suppresses the native link menu so it can never navigate the window", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({ thread: view(OWNER_PROMPT), openExternalLink });

    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      promptBody().querySelector("a")?.dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it.each([
    [0, 1],
    [1, 1],
    [2, 0],
  ])("opens a user link for button %i %i time(s)", (button, calls) => {
    const openExternalLink = vi.fn(async () => undefined);
    render({ thread: view(OWNER_PROMPT), openExternalLink });

    const event = click(promptBody().querySelector("a"), { button });
    expect(openExternalLink).toHaveBeenCalledTimes(calls);
    expect(event.defaultPrevented).toBe(calls === 1);
  });

  it("keeps non-http schemes and markdown syntax literal and preserves whitespace exactly", () => {
    const openExternalLink = vi.fn(async () => undefined);
    const prompt =
      "javascript:alert(1)\n  file:///etc/passwd  data:text/html,x\n**bold** [docs](https://example.com/docs).";
    render({ thread: view(prompt), openExternalLink });

    const body = promptBody();
    expect(body.textContent).toBe(prompt);
    expect(body.querySelector("strong")).toBeNull();
    expect([...body.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"))).toEqual([
      "https://example.com/docs",
    ]);
  });

  it("copies the original prompt text, not a rendered form", async () => {
    const writeText = vi.fn(async () => undefined);
    const textClipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
    render({ thread: view(OWNER_PROMPT), openExternalLink: vi.fn(), textClipboard });

    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy your message"]');
    expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith(OWNER_PROMPT);
  });

  it("splits a find match that crosses into a link without changing its index", () => {
    const thread = view(`pozri merge ${MR}`);
    const hits = findInThread(thread.thread, "merge https", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    expect(hits).toHaveLength(1);

    render({
      thread,
      findQuery: "merge https",
      findHits: hits,
      findHitIndex: 0,
      openExternalLink: vi.fn(),
    });

    const marks = [...promptBody().querySelectorAll<HTMLElement>("mark.agent-find__hit--current")];
    expect(marks.map((mark) => [mark.textContent, mark.dataset.hitIndex])).toEqual([
      ["merge ", "0"],
      ["https", "0"],
    ]);
    expect(marks[0]?.closest("a")).toBeNull();
    expect(marks[1]?.closest("a.agent-prompt__link")).not.toBeNull();
  });

  it("keeps find highlights and their indices around and inside a link", () => {
    const prompt = `pozri merge ${MR} a merge`;
    const thread = view(prompt);
    const hits = findInThread(thread.thread, "merge", {
      maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN,
    });
    expect(hits).toHaveLength(3);

    render({
      thread,
      findQuery: "merge",
      findHits: hits,
      findHitIndex: 1,
      openExternalLink: vi.fn(),
    });

    const body = promptBody();
    const marks = [...body.querySelectorAll<HTMLElement>("mark.agent-find__hit")];
    expect(marks.map((mark) => mark.dataset.hitIndex)).toEqual(["0", "1", "2"]);
    const current = body.querySelector<HTMLElement>("mark.agent-find__hit--current");
    expect(current?.dataset.hitIndex).toBe("1");
    expect(current?.closest("a.agent-prompt__link")?.getAttribute("href")).toBe(MR);
    expect(body.textContent).toBe(prompt);
  });

  it("links URLs in a message sent while the agent was working", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({
      thread: view("Check the project", [{ kind: "userMessage", text: `a ešte ${MR}.` }]),
      openExternalLink,
    });

    const steered = host.querySelector(".agent-prompt--steered .agent-prompt__body");
    expect(steered?.textContent).toBe(`a ešte ${MR}.`);
    click(steered?.querySelector("a"));
    expect(openExternalLink).toHaveBeenCalledExactlyOnceWith(MR);
  });

  it("links URLs in a queued message and in a message that is still sending", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({
      thread: view("Check the project"),
      openExternalLink,
      pendingSend: {
        id: 1,
        target: { kind: "followUp", threadId: "agt-1", baseTurnId: null },
        prompt: "sending https://sending.example/x",
        attachments: [],
        sentAtEpochMs: NOW,
        status: "sending",
      },
      deferredFollowUps: [
        {
          id: "queued-1",
          queuedAtEpochMs: NOW,
          request: {
            threadId: "agt-1",
            prompt: "queued https://queued.example/y",
            launch: {
              provider: "claudeCode",
              model: "default",
              mode: "default",
              effort: "default",
            },
          },
        },
      ],
    });

    const queued = host.querySelector('[data-agent-queued="queued-1"] a.agent-prompt__link');
    click(queued);
    const pending = host.querySelector('[data-pending-send="sending"] a.agent-prompt__link');
    click(pending);
    expect(openExternalLink.mock.calls).toEqual([
      ["https://queued.example/y"],
      ["https://sending.example/x"],
    ]);
  });
});

function view(prompt: string, events: ReadonlyArray<AgentTurnEvent> = []): AgentThreadView {
  const turn: AgentTurn = {
    turnId: "agt-1-t1",
    prompt,
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Links",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [turn],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
