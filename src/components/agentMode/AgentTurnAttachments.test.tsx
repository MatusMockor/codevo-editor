// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentAttachmentImageState,
  AgentAttachmentImagesSurface,
} from "../../application/useAgentAttachmentImages";
import { agentAttachmentImageKey } from "../../application/useAgentAttachmentImages";
import type { AgentAttachment } from "../../domain/agentAttachment";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { findInThread } from "../../domain/agentThreadSearch";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import {
  parseExternalSessionExchange,
  type ExternalSessionExchange,
} from "../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentTurnAttachments } from "./AgentTurnAttachments";
import { AgentClockProvider } from "./agentClock";
import {
  AGENT_ATTACHMENT_DECODE_FAILED_REASON,
  AGENT_ATTACHMENT_UNAVAILABLE_LABEL,
  AGENT_IMPORTED_IMAGE_LABEL,
} from "./agentTurnAttachmentPresentation";

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const IMAGE_ID = "a".repeat(32);
const FILE_ID = "b".repeat(32);
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const STORED_IMAGE = `/data/agent-attachments/threads/${THREAD_ID}/${IMAGE_ID}.png`;
const STORED_FILE = `/data/agent-attachments/threads/${THREAD_ID}/${FILE_ID}.bin`;
const REFERENCE_PATH = "/workspace/app/clip.mp4";

const IMAGE_ATTACHMENT: AgentAttachment = {
  kind: "image",
  attachmentId: IMAGE_ID,
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: STORED_IMAGE,
};

const FILE_ATTACHMENT: AgentAttachment = {
  kind: "file",
  attachmentId: FILE_ID,
  name: "notes.txt",
  bytes: 1_024,
  storedPath: STORED_FILE,
};

const REFERENCE_ATTACHMENT: AgentAttachment = {
  kind: "reference",
  name: "clip.mp4",
  path: REFERENCE_PATH,
  bytes: 5_000_000,
};

const IMAGE_LINE = `[Attached image "shot.png" is saved at: ${STORED_IMAGE}]`;
const FILE_LINE = `[Attached file "notes.txt" is saved at: ${STORED_FILE}]`;
const REFERENCE_LINE = `[Attached file "clip.mp4" is at: ${REFERENCE_PATH}]`;
const EFFECTIVE_PROMPT = ["Look at this", "", IMAGE_LINE, REFERENCE_LINE].join("\n");
const UNAVAILABLE_REASON = "Agent task workspace is not registered or its identity changed.";

describe("agent turn attachments", () => {
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

  it("renders a sent image inline under its prompt and opens it on click", () => {
    const ensure = vi.fn();
    const onRevealAttachment = vi.fn();
    render({
      attachmentImages: imagesSurface({ ensure, state: { kind: "ready", url: "blob:shot" } }),
      onRevealAttachment,
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT, REFERENCE_ATTACHMENT])]),
    });

    expect(ensure).toHaveBeenCalledWith({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      attachmentId: IMAGE_ID,
      mime: "image/png",
    });

    const prompt = host.querySelector(".agent-prompt");
    const image = prompt?.querySelector<HTMLImageElement>(".agent-attachments__image");
    expect(image?.getAttribute("src")).toBe("blob:shot");
    expect(image?.alt).toBe("shot.png");
    expect(image?.getAttribute("width")).toBe("800");
    expect(image?.getAttribute("height")).toBe("600");

    act(() => {
      prompt?.querySelector<HTMLButtonElement>(".agent-attachments__open")?.click();
    });

    expect(onRevealAttachment).toHaveBeenCalledWith(THREAD_ID, IMAGE_ID);
  });

  it("reserves the image's display box while it loads so the column does not shift", () => {
    render({
      attachmentImages: imagesSurface({ state: { kind: "loading" } }),
      thread: liveThread([
        turn(EFFECTIVE_PROMPT, [{ ...IMAGE_ATTACHMENT, width: 1_000, height: 300 }]),
      ]),
    });

    const pending = host.querySelector<HTMLElement>(".agent-attachments__pending");
    expect(pending?.style.width).toBe("320px");
    expect(pending?.style.height).toBe("96px");
  });

  it("keeps the default placeholder for an image view without dimensions", () => {
    act(() => {
      root.render(
        <AgentTurnAttachments
          attachments={[
            {
              kind: "image",
              key: IMAGE_ID,
              name: "shot.png",
              attachmentId: IMAGE_ID,
              mime: "image/png",
            },
          ]}
          images={{
            stateOf: () => ({ kind: "loading" }),
            ensure: () => undefined,
            reveal: () => undefined,
          }}
        />,
      );
    });

    const pending = host.querySelector<HTMLElement>(".agent-attachments__pending");
    expect(pending).not.toBeNull();
    expect(pending?.getAttribute("style")).toBeNull();
  });

  it("shows a truthful unavailable state carrying the gateway's reason", () => {
    render({
      attachmentImages: imagesSurface({
        state: { kind: "unavailable", reason: UNAVAILABLE_REASON },
      }),
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT])]),
    });

    expect(host.querySelector(".agent-attachments__image")).toBeNull();
    const chip = host.querySelector<HTMLElement>("[data-agent-attachment='unavailable']");
    expect(chip?.querySelector(".agent-attachments__name")?.textContent).toBe(
      AGENT_ATTACHMENT_UNAVAILABLE_LABEL,
    );
    expect(chip?.title).toBe(`shot.png: ${UNAVAILABLE_REASON}`);
    expect(chip?.querySelector(".agent-visually-hidden")?.textContent).toBe(
      `shot.png: ${UNAVAILABLE_REASON}`,
    );
  });

  it("keeps every attachment inside the prompt bubble under the text", () => {
    render({
      attachmentImages: imagesSurface({
        state: { kind: "unavailable", reason: UNAVAILABLE_REASON },
      }),
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT, REFERENCE_ATTACHMENT])]),
    });

    const bubble = host.querySelector(".agent-prompt__bubble");
    const body = bubble?.querySelector(".agent-prompt__body");
    const attachments = bubble?.querySelector(".agent-attachments");
    expect(body).not.toBeNull();
    expect(attachments).not.toBeNull();
    expect(bubble?.children).toHaveLength(2);
    expect(bubble?.firstElementChild).toBe(body);
    expect(bubble?.lastElementChild).toBe(attachments);
    expect(host.querySelector(".agent-prompt > .agent-attachments")).toBeNull();
    expect(bubble?.getAttribute("tabindex")).toBe("-1");
  });

  it("hides the image store line from the bubble while file and reference lines stay", () => {
    const prompt = ["Look at this", "", IMAGE_LINE, FILE_LINE, REFERENCE_LINE].join("\n");
    render({
      attachmentImages: imagesSurface({ state: { kind: "ready", url: "blob:shot" } }),
      thread: liveThread([turn(prompt, [IMAGE_ATTACHMENT, FILE_ATTACHMENT, REFERENCE_ATTACHMENT])]),
    });

    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe(
      ["Look at this", "", FILE_LINE, REFERENCE_LINE].join("\n"),
    );
    expect(host.querySelector(".agent-attachments__image")).not.toBeNull();
  });

  it("drops the empty text block when the prompt was only an image", () => {
    render({
      attachmentImages: imagesSurface({ state: { kind: "ready", url: "blob:shot" } }),
      thread: liveThread([turn(IMAGE_LINE, [IMAGE_ATTACHMENT])]),
    });

    expect(host.querySelector(".agent-prompt__body")).toBeNull();
    expect(host.querySelector(".agent-prompt__bubble .agent-attachments__image")).not.toBeNull();
  });

  it("hides an imported prompt's image line exactly like a live turn", () => {
    render({
      thread: importedThread([
        importedExchange("user", `Look\n\n${IMAGE_LINE}`, [{ kind: "image", mime: "image/png" }]),
        importedExchange("assistant", `quoting ${IMAGE_LINE}`, []),
      ]),
    });

    const bodies = [...host.querySelectorAll(".agent-prompt__body")];
    expect(bodies.map((body) => body.textContent)).toEqual(["Look"]);
    expect(host.querySelector(".agent-prompt__bubble .agent-attachments")).not.toBeNull();
  });

  it("highlights a find hit only inside the displayed prompt text", () => {
    const prompt = ["Look at shot", "", IMAGE_LINE].join("\n");
    const thread = liveThread([turn(prompt, [IMAGE_ATTACHMENT])]);
    const hits = findInThread(thread.thread, "shot");
    render({
      attachmentImages: imagesSurface({ state: { kind: "ready", url: "blob:shot" } }),
      findHitIndex: 0,
      findHits: hits,
      findQuery: "shot",
      thread,
    });

    expect(hits).toEqual([
      { scope: "turn", turnId: "agt-1-t1", eventIndex: null, start: 8, end: 12 },
    ]);
    expect(host.querySelectorAll(".agent-prompt__body mark.agent-find__hit")).toHaveLength(1);
    expect(host.querySelector("mark.agent-find__hit--current")?.textContent).toBe("shot");
  });

  it("falls back to the unavailable state when the loaded bytes do not decode", () => {
    render({
      attachmentImages: imagesSurface({ state: { kind: "ready", url: "blob:broken" } }),
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT])]),
    });

    act(() => {
      host
        .querySelector<HTMLImageElement>(".agent-attachments__image")
        ?.dispatchEvent(new Event("error"));
    });

    expect(host.querySelector(".agent-attachments__image")).toBeNull();
    const chip = host.querySelector<HTMLElement>("[data-agent-attachment='unavailable']");
    expect(chip).not.toBeNull();
    expect(chip?.title).toBe(`shot.png: ${AGENT_ATTACHMENT_DECODE_FAILED_REASON}`);

    render({
      attachmentImages: imagesSurface({ state: { kind: "ready", url: "blob:fresh" } }),
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT])]),
    });

    expect(host.querySelector<HTMLImageElement>(".agent-attachments__image")?.src).toBe(
      "blob:fresh",
    );
  });

  it("renders file and reference attachments as named chips", () => {
    render({
      thread: liveThread([turn("Read these", [FILE_ATTACHMENT, REFERENCE_ATTACHMENT])]),
    });

    expect(chipNames()).toEqual(["notes.txt", "clip.mp4"]);
    expect(
      [...host.querySelectorAll(".agent-attachments__chip")].map((chip) =>
        chip.getAttribute("data-agent-attachment"),
      ),
    ).toEqual(["file", "reference"]);
  });

  it("renders an imported exchange attachment through the same chip markup as a live turn", () => {
    render({ thread: liveThread([turn("Read these", [FILE_ATTACHMENT])]) });
    const live = host.querySelector(".agent-attachments")?.outerHTML ?? "";

    render({
      thread: importedThread([
        importedExchange("user", "Read these", [{ kind: "file", name: "notes.txt" }]),
        importedExchange("assistant", "sure", []),
      ]),
    });
    const imported = host.querySelector(".agent-attachments")?.outerHTML ?? "";

    expect(live).not.toBe("");
    expect(imported).toBe(live);
  });

  it("renders an imported image as the session-file chip, never a blank tile", () => {
    render({
      thread: importedThread([
        importedExchange("user", "Look", [{ kind: "image", mime: "image/png" }]),
      ]),
    });

    expect(chipNames()).toEqual([AGENT_IMPORTED_IMAGE_LABEL]);
    expect(host.querySelector(".agent-attachments__image")).toBeNull();
  });

  it("ignores an imported attachment entry that does not parse", () => {
    render({
      thread: importedThread([
        importedExchange("user", "Look", [{ kind: "archive" }, { kind: "file" }]),
      ]),
    });

    expect(host.querySelector(".agent-attachments")).toBeNull();
  });

  it("copies the effective prompt including its attachment path lines", async () => {
    const writeText = vi.fn(async () => undefined);
    const textClipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
    render({
      textClipboard,
      thread: liveThread([turn(EFFECTIVE_PROMPT, [IMAGE_ATTACHMENT, REFERENCE_ATTACHMENT])]),
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-prompt .agent-message-actions button")?.click();
    });

    expect(writeText).toHaveBeenCalledWith(EFFECTIVE_PROMPT);
  });

  function chipNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-attachments__name")].map(
      (name) => name.textContent ?? "",
    );
  }

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={600_000}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            markdownViewport={null}
            onReviewInDiff={() => undefined}
            thread={null}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }
});

function imagesSurface({
  ensure = () => undefined,
  state = null,
}: {
  ensure?: AgentAttachmentImagesSurface["ensure"];
  state?: AgentAttachmentImageState | null;
}): AgentAttachmentImagesSurface {
  const images = new Map<string, AgentAttachmentImageState>();
  if (state !== null) images.set(agentAttachmentImageKey(OWNER_ID, THREAD_ID, IMAGE_ID), state);
  return { images, ensure, holdThread: () => () => undefined, releaseWorkspace: () => undefined };
}

function turn(prompt: string, attachments: ReadonlyArray<AgentAttachment>): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt,
    status: SETTLED,
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: NOW - 30_000,
    events: [{ kind: "assistantText", text: "done" }],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    attachments,
  };
}

function importedExchange(
  role: "user" | "assistant",
  text: string,
  attachments: ReadonlyArray<object>,
): ExternalSessionExchange {
  return parseExternalSessionExchange({ role, text, attachments });
}

function liveThread(turns: ReadonlyArray<AgentTurn>): AgentThreadView {
  return threadView(turns, null);
}

function importedThread(exchanges: ReadonlyArray<ExternalSessionExchange>): AgentThreadView {
  return threadView([], {
    provider: "claudeCode",
    sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
    importedAtEpochMs: NOW - 60_000,
    history: {
      provider: "claudeCode",
      sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
      exchanges,
      exchangesTruncated: false,
      totalPreviewBytes: 32,
    },
  });
}

function threadView(
  turns: ReadonlyArray<AgentTurn>,
  externalOrigin: AgentThread["externalOrigin"],
): AgentThreadView {
  const record: AgentThread = {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 600_000,
    updatedAtEpochMs: NOW - 60_000,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(record),
    unread: agentThreadUnread(record),
    thread: record,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
