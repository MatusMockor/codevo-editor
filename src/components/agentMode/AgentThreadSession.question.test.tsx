// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentAttachmentImages } from "../../application/useAgentAttachmentImages";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentThreadSession } from "./AgentThreadSession";

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const IMAGE_ANSWER =
  'Your questions have been answered: "Which layout is broken?"="Sidebar\n\n' +
  `[Attached image "screen.png" is saved at: /data/agent-attachments/threads/thread/${IMAGE_ID}.png]". ` +
  "You can now continue with these answers in mind.";
const QA_TOOL_ID = "toolu_01St7kbjjnQLSqHsZwvtRxKx";
const QA_IMAGE_ID = "747fe7cabc7c35cf4012f0a89d223b0c";
const QA_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  {
    kind: "unknownLine",
    stream: "stdout",
    raw: "Unsupported Claude stream frame: command_lifecycle",
    clipped: false,
  },
  {
    kind: "assistantText",
    text: "Invoking superpowers:using-superpowers to understand how to proceed with your request.",
  },
  {
    kind: "toolCall",
    toolId: "toolu_01Xtta8yCj3b7A5Xe7jtX5rp",
    name: "Skill",
    inputSummary: '{"skill":"superpowers:using-superpowers"}',
  },
  {
    kind: "toolResult",
    toolId: "toolu_01Xtta8yCj3b7A5Xe7jtX5rp",
    outputSummary: "Launching skill: superpowers:using-superpowers",
    isError: false,
  },
  { kind: "assistantText", text: "Teraz ti položím otázku o tvojej obľúbenej farbe." },
  {
    kind: "toolCall",
    toolId: QA_TOOL_ID,
    name: "AskUserQuestion",
    inputSummary:
      '{"questions":[{"question":"Ktorú farbu preferuješ?","header":"Farba","multiSelect":false,"options":[{"label":"Červená","description":"Živá a energická farba"},{"label":"Modrá","description":"Pokojná a upokojujúca farba"}]}]}',
  },
  {
    kind: "toolResult",
    toolId: QA_TOOL_ID,
    outputSummary:
      'The user answered: "Ktorú farbu preferuješ?"="Červená, \n\n[Attached image "qa-image.png" is saved at: /Users/me/Library/Application Support/dev.mockor.editor.qa/agent-attachments/threads/agt-mun52scd-3d6e/' +
      QA_IMAGE_ID +
      '.png]". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    isError: false,
  },
  {
    kind: "assistantText",
    text: "Výborně! Dostal som tvoju odpoveď:\n\n**Vybrali ste: Červená**",
  },
  {
    kind: "result",
    text: "Výborně! Dostal som tvoju odpoveď:\n\n**Vybrali ste: Červená**",
    isError: false,
    usage: { inputTokens: 92_999, outputTokens: 334, contextTokens: 92_999 },
  },
];
const read = vi.fn(async () => new ArrayBuffer(16));
const gateway = { readAgentAttachment: read } as unknown as AgentAttachmentGateway;

function WithImages({ view }: { readonly view: AgentThreadView }) {
  const images = useAgentAttachmentImages({
    gateway,
    reportError: () => undefined,
    createObjectUrl: () => "blob:answer",
    revokeObjectUrl: () => undefined,
  });
  return (
    <AgentThreadSession
      attachmentImages={images}
      thread={view}
      composerRepositoryLabel="app"
      onReviewInDiff={() => {}}
    />
  );
}

const QUESTION_TOOL_ID = "toolu_question";
const INPUT = JSON.stringify({
  questions: [{ question: "Which layout is broken?", header: "Layout", options: [] }],
});
const ANSWER =
  'Your questions have been answered: "Which layout is broken?"="Sidebar". You can now continue with these answers in mind.';

const EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Let me ask first." },
  { kind: "toolCall", toolId: QUESTION_TOOL_ID, name: "AskUserQuestion", inputSummary: INPUT },
  { kind: "toolResult", toolId: QUESTION_TOOL_ID, outputSummary: ANSWER, isError: false },
  { kind: "assistantText", text: "Fixing the sidebar now." },
];

describe("an answered question in the transcript", () => {
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

  it("loads thumbnails for an image attached to the answer when the prompt had none", async () => {
    read.mockClear();
    render(
      [
        EVENTS[0]!,
        EVENTS[1]!,
        {
          kind: "toolResult",
          toolId: QUESTION_TOOL_ID,
          outputSummary: IMAGE_ANSWER,
          isError: false,
        },
      ],
      { kind: "running" },
      false,
      true,
    );
    const row = host.querySelector<HTMLButtonElement>(".agent-question-row button.cv-work-row")!;
    act(() => row.click());
    await waitForReact(() =>
      expect(host.querySelector(".agent-question-row .agent-attachments__image")).not.toBeNull(),
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread", attachmentId: IMAGE_ID }),
    );
    expect(host.querySelector(".agent-question-row")?.textContent).not.toContain(
      "Image unavailable",
    );
  });

  it("renders as a compact answered work row where the question was asked", () => {
    render(EVENTS, { kind: "running" }, false);
    const row = host.querySelector<HTMLButtonElement>(".agent-question-row button.cv-work-row");
    expect(row?.textContent).toContain("Answered");
    expect(row?.textContent).toContain("Which layout is broken?");
    expect(row?.textContent).not.toContain("AskUserQuestion");
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    const text = host.querySelector(".agent-turn")?.textContent ?? "";
    expect(text.indexOf("Let me ask first.")).toBeLessThan(text.indexOf("Answered"));
    expect(text.indexOf("Answered")).toBeLessThan(text.indexOf("Fixing the sidebar now."));
  });

  it("keeps the answered row with its image visible in a settled turn replayed from the QA log", async () => {
    read.mockClear();
    render(QA_EVENTS, { kind: "exited", exitCode: 0 }, false, true);
    const row = host.querySelector<HTMLButtonElement>(".agent-question-row button.cv-work-row");
    expect(row?.textContent).toContain("Answered");
    expect(row?.textContent).toContain("Ktorú farbu preferuješ?");
    expect(host.querySelector(".agent-question-row__answer")?.textContent).toBe("Červená");
    expect(row?.closest("details:not([open])")).toBeNull();
    act(() => row!.click());
    await waitForReact(() =>
      expect(host.querySelector(".agent-question-row .agent-attachments__image")).not.toBeNull(),
    );
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: QA_IMAGE_ID }));
  });

  function render(
    events: ReadonlyArray<AgentTurnEvent>,
    status: AgentTurnStatus,
    haltRequested: boolean,
    images = false,
  ) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "Run the loop",
      status,
      events,
      startedAtEpochMs: Date.now() - 32_000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
      ...(haltRequested ? { haltRequested: true } : {}),
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Loop",
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
      attention: "running",
      unread: false,
      lifecycle: "running",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        images ? (
          <WithImages view={view} />
        ) : (
          <AgentThreadSession
            thread={view}
            composerRepositoryLabel="app"
            onReviewInDiff={() => {}}
          />
        ),
      ),
    );
  }
});
