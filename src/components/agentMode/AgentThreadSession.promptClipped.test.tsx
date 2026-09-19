// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  CLIPPED_AGENT_PROMPT_MARKER,
  clipAgentPromptForPersistence,
} from "../../domain/agentPromptClipping";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";
import { AGENT_PROMPT_CLIPPED_COPY_BLOCKED, AGENT_PROMPT_CLIPPED_NOTICE } from "./AgentTurnParts";

const TURN_ID = "agt-1-0a1c";
const FULL_PROMPT = `Rewrite the tokenizer ${"and keep every escape sequence working ".repeat(40)}`;

function clippedPrompt(): string {
  const projection = clipAgentPromptForPersistence(FULL_PROMPT);
  expect(projection).not.toBeNull();
  return projection ?? FULL_PROMPT;
}

describe("a clipped turn prompt in the thread session", () => {
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

  function render(prompt: string, promptRestored?: boolean): void {
    const turn: AgentTurn = {
      turnId: TURN_ID,
      prompt,
      status: { kind: "exited", exitCode: 0 },
      events: [{ kind: "assistantText", text: "Done with the parser." }],
      startedAtEpochMs: 0,
      endedAtEpochMs: 1,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
      ...(promptRestored === undefined ? {} : { promptRestored }),
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "agt-1-0a1b",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Parser",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [turn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "settled",
      unread: false,
      lifecycle: "settled",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
          turnLog={null}
        />,
      ),
    );
  }

  function copyButton(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".agent-prompt .agent-message-copy");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  it("blocks copying with a truthful reason and shows where the full message lives", () => {
    render(clippedPrompt());

    expect(copyButton().disabled).toBe(true);
    expect(copyButton().title).toBe(AGENT_PROMPT_CLIPPED_COPY_BLOCKED);
    expect(host.textContent).toContain(AGENT_PROMPT_CLIPPED_NOTICE);
  });

  it("keeps the shortened prefix visible so /compact and search still match", () => {
    render(clippedPrompt());

    expect(host.textContent).toContain("Rewrite the tokenizer");
    expect(host.textContent).toContain(CLIPPED_AGENT_PROMPT_MARKER);
  });

  it("allows copying again once the log restored the prompt", () => {
    render(FULL_PROMPT, true);

    expect(copyButton().disabled).toBe(false);
    expect(copyButton().title).toBe("Copy your message");
    expect(host.textContent).not.toContain(AGENT_PROMPT_CLIPPED_NOTICE);
  });

  it("allows copying a prompt that only looks clipped once it was reconciled", () => {
    render(`keep this ending ${CLIPPED_AGENT_PROMPT_MARKER}`, true);

    expect(copyButton().disabled).toBe(false);
    expect(host.textContent).not.toContain(AGENT_PROMPT_CLIPPED_NOTICE);
  });

  it("never blocks an ordinary prompt", () => {
    render("fix the parser");

    expect(copyButton().disabled).toBe(false);
    expect(host.textContent).not.toContain(AGENT_PROMPT_CLIPPED_NOTICE);
  });
});
