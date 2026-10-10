// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentTurnEvent,
} from "../../domain/agentThread";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import type { AgentServerLoopbackPort } from "./agentMarkdownLinks";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

const NOW = 1_700_000_600_000;
const ROOT = "/workspace/app";
const APP = "http://localhost:3000/login";
const DOCS = "https://example.com/docs";
const ANSWER = `The app runs at [the login page](${APP}); see [the docs](${DOCS}).`;
const PROMPT = "Why does http://127.0.0.1:5173/ show a blank page?";

describe("AgentThreadSession localhost links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

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

  function click(href: string, scope: string): MouseEvent {
    const anchor = [...host.querySelectorAll<HTMLAnchorElement>(`${scope} a`.trim())].find(
      (candidate) => candidate.getAttribute("href") === href,
    );
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      anchor?.dispatchEvent(event);
    });
    return event;
  }

  it("opens localhost links of a server thread through the server, never on this computer", () => {
    const openExternalLink = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    render({ thread: view(true), openExternalLink, serverLoopback: serverPort(openLoopback) });

    expect(click(APP, ".agent-text").defaultPrevented).toBe(true);
    click("http://127.0.0.1:5173/", ".agent-prompt__body");
    click(DOCS, ".agent-text");

    expect(openLoopback.mock.calls).toEqual([[APP], ["http://127.0.0.1:5173/"]]);
    expect(openExternalLink.mock.calls).toEqual([[DOCS]]);
  });

  it("titles forwardable answer links with the server port and leaves other links untitled", () => {
    render({ thread: view(true), serverLoopback: serverPort(vi.fn(async () => undefined)) });

    const anchors = [...host.querySelectorAll<HTMLAnchorElement>(".agent-text a")];
    const titles = anchors.map((anchor) => [anchor.getAttribute("href"), anchor.title]);
    expect(titles).toEqual([
      [APP, "Opens build-box:3000 through the SSH connection"],
      [DOCS, ""],
    ]);
  });

  it("routes localhost links in thoughts, queued and sending messages and imported history to the server", () => {
    const openExternalLink = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    render({
      thread: imported(
        view(true, [{ kind: "reasoning", text: "Check [it](http://localhost:3001/)." }]),
      ),
      openExternalLink,
      serverLoopback: serverPort(openLoopback),
      importedHistory: {
        provider: "claudeCode",
        sessionId: "session-abcdefgh",
        exchanges: [{ role: "assistant", text: "Earlier: [app](http://localhost:3002/)" }],
        exchangesTruncated: false,
        totalPreviewBytes: 64,
      },
      pendingSend: {
        id: 1,
        target: { kind: "followUp", threadId: "agt-1", baseTurnId: null },
        prompt: "sending http://localhost:3003/",
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
            prompt: "queued http://localhost:3004/",
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
    for (let round = 0; round < 3; round += 1)
      for (const toggle of host.querySelectorAll<HTMLButtonElement>(
        '.agent-turn-list button[aria-expanded="false"]',
      ))
        act(() => toggle.click());

    for (const url of [
      "http://localhost:3001/",
      "http://localhost:3002/",
      "http://localhost:3003/",
      "http://localhost:3004/",
    ])
      click(url, "");

    expect(openLoopback.mock.calls).toEqual([
      ["http://localhost:3001/"],
      ["http://localhost:3002/"],
      ["http://localhost:3003/"],
      ["http://localhost:3004/"],
    ]);
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it("routes localhost links of a message starting a new server conversation to the server", () => {
    const openExternalLink = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    const start = (projectRootKey: string) => ({
      id: 2,
      target: { kind: "new" as const, projectRootKey, provider: "claudeCode" as const },
      prompt: "start http://localhost:3000/",
      attachments: [],
      sentAtEpochMs: NOW,
      status: "sending" as const,
    });
    render({
      openExternalLink,
      serverLoopback: serverPort(openLoopback),
      pendingSend: start("remote:linux:7389088c:app"),
    });
    click("http://localhost:3000/", "");
    render({
      openExternalLink,
      serverLoopback: serverPort(openLoopback),
      pendingSend: start(ROOT),
    });
    click("http://localhost:3000/", "");

    expect(openLoopback.mock.calls).toEqual([["http://localhost:3000/"]]);
    expect(openExternalLink.mock.calls).toEqual([["http://localhost:3000/"]]);
  });

  it("refuses localhost links of a server thread when no server route is wired", () => {
    const openExternalLink = vi.fn(async () => undefined);
    render({ thread: view(true), openExternalLink });

    expect(click(APP, ".agent-text").defaultPrevented).toBe(true);
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it("keeps localhost links of a local thread opening on this computer", () => {
    const openExternalLink = vi.fn(async () => undefined);
    const openLoopback = vi.fn(async () => undefined);
    render({ thread: view(false), openExternalLink, serverLoopback: serverPort(openLoopback) });

    click(APP, ".agent-text");
    click("http://127.0.0.1:5173/", ".agent-prompt__body");

    expect(openExternalLink.mock.calls).toEqual([[APP], ["http://127.0.0.1:5173/"]]);
    expect(openLoopback).not.toHaveBeenCalled();
  });
});

function imported(view: AgentThreadView): AgentThreadView {
  return {
    ...view,
    thread: {
      ...view.thread,
      externalOrigin: {
        provider: "claudeCode",
        sessionId: "session-abcdefgh",
        importedAtEpochMs: NOW - 120_000,
      },
    },
  };
}

function serverPort(
  openLoopback: AgentServerLoopbackPort["openLoopback"],
): AgentServerLoopbackPort {
  return {
    openLoopback,
    titleFor: (url) => (url === APP ? "Opens build-box:3000 through the SSH connection" : null),
  };
}

function view(remote: boolean, extra: ReadonlyArray<AgentTurnEvent> = []): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Dev server",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: PROMPT,
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: NOW - 60_000,
        endedAtEpochMs: NOW - 30_000,
        events: [...extra, { kind: "assistantText", text: ANSWER }],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
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
    ...(remote
      ? {
          execution: {
            kind: "remote" as const,
            serverId: "linux",
            runnerId: "7389088c-29b8-4cec-9a15-e825e1fb2f66",
            projectId: "app",
            conversationId: "conversation-1",
            latestTaskId: "0f8fad5b-d9cb-469f-a165-70867728950e",
            resume: null,
            reachability: REMOTE_RUNNER_REACHABLE,
          },
        }
      : {}),
  };
}
