// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentAttachmentImageKey,
  type AgentAttachmentImageState,
  type AgentAttachmentImagesSurface,
} from "../../application/useAgentAttachmentImages";
import type { AgentAttachment } from "../../domain/agentAttachment";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentTurn,
} from "../../domain/agentThread";
import {
  parseExternalSessionExchange,
  type ExternalSessionExchange,
} from "../../domain/externalAgentSession";
import { AGENT_LIGHTBOX_CLOSE_LABEL, AGENT_LIGHTBOX_REVEAL_LABEL } from "./AgentAttachmentLightbox";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const OTHER_OWNER_ID = "agent-root:other";
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const OTHER_THREAD_ID = "agt-2";
const IMAGE_ID = "a".repeat(32);
const IMAGE_URL = "blob:shot";

const IMAGE_ATTACHMENT: AgentAttachment = {
  kind: "image",
  attachmentId: IMAGE_ID,
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: `/data/agent-attachments/threads/${THREAD_ID}/${IMAGE_ID}.png`,
};

describe("agent attachment lightbox", () => {
  let host: HTMLDivElement;
  let shell: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    shell = document.createElement("div");
    shell.className = "app-shell";
    host.append(shell);
    document.body.append(host);
    root = createRoot(shell);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens the clicked image over the app shell from the same object URL, outside the transcript", () => {
    const onRevealAttachment = vi.fn();
    render({ attachmentImages: readySurface(), onRevealAttachment });
    const chainBefore = scrollerChain();

    openLightbox();

    const dialog = lightbox();
    expect(dialog.parentElement).toBe(shell);
    expect(dialog.closest(".agent-session")).toBeNull();
    expect(dialog.closest(".agent-session__scroll")).toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("shot.png");
    expect(dialog.classList.contains("palette-backdrop")).toBe(true);
    const image = dialog.querySelector<HTMLImageElement>(".agent-lightbox__image");
    expect(image?.getAttribute("src")).toBe(IMAGE_URL);
    expect(image?.alt).toBe("shot.png");
    expect(image?.getAttribute("width")).toBe("800");
    expect(image?.getAttribute("height")).toBe("600");
    expect(image?.style.maxWidth).toBe("min(90vw, 800px)");
    expect(image?.style.maxHeight).toBe("min(90vh, 600px)");
    expect(document.querySelectorAll(".agent-lightbox")).toHaveLength(1);
    expect(scrollerChain()).toEqual(chainBefore);
    expect(document.body.className).toBe("");
    expect(onRevealAttachment).not.toHaveBeenCalled();
  });

  it("shows the close control first in the tab order and focuses it on open", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();

    const buttons = [...lightbox().querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      AGENT_LIGHTBOX_CLOSE_LABEL,
      AGENT_LIGHTBOX_REVEAL_LABEL,
    ]);
    expect(buttons[0]?.hidden).toBe(false);
    expect(buttons[0]?.querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("closes from the close control by click, Enter and Space and returns focus to the thumbnail", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    act(() => closeControl().click());
    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());

    openLightbox();
    press(closeControl(), "Enter");
    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());

    openLightbox();
    press(closeControl(), " ");
    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("closes on Escape and returns focus to the thumbnail", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    press(closeControl(), "Escape");

    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("closes on a backdrop press but not on a press on the image or the controls", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    pressMouse(lightbox().querySelector(".agent-lightbox__image"));
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
    pressMouse(lightbox().querySelector(".agent-lightbox__controls"));
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();

    pressMouse(lightbox());

    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("keeps Tab inside the close and open-in-viewer controls", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    const [close, reveal] = [...lightbox().querySelectorAll<HTMLButtonElement>("button")];
    expect(close).toBeDefined();
    expect(reveal).toBeDefined();

    press(reveal ?? null, "Tab");
    expect(document.activeElement).toBe(close);

    press(close ?? null, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(reveal);

    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
  });

  it("opens the system viewer from the secondary control with ids only and stays open", () => {
    const onRevealAttachment = vi.fn();
    render({ attachmentImages: readySurface(), onRevealAttachment });

    openLightbox();
    act(() => {
      lightbox()
        .querySelector<HTMLButtonElement>(`button[aria-label="${AGENT_LIGHTBOX_REVEAL_LABEL}"]`)
        ?.click();
    });

    expect(onRevealAttachment).toHaveBeenCalledTimes(1);
    expect(onRevealAttachment).toHaveBeenCalledWith(THREAD_ID, IMAGE_ID);
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
  });

  it("offers no lightbox while the image is still loading", () => {
    render({ attachmentImages: surface({ kind: "loading" }) });

    expect(shell.querySelector(".agent-attachments__open")).toBeNull();
    expect(shell.querySelector(".agent-attachments__pending")).not.toBeNull();
    expect(document.querySelector(".agent-lightbox")).toBeNull();
  });

  it("closes without stranding focus when the cache entry stops being ready while open", () => {
    render({ attachmentImages: readySurface() });
    openLightbox();
    const opener = thumbnail();

    render({ attachmentImages: surface({ kind: "loading" }) });

    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(opener.isConnected).toBe(false);
    expect(shell.querySelector(".agent-attachments__pending")).not.toBeNull();
    expect(document.activeElement?.closest(".agent-lightbox") ?? null).toBeNull();
  });

  it("fails closed when the session moves to another thread while open", () => {
    render({ attachmentImages: readySurface() });
    openLightbox();

    render({
      attachmentImages: readySurface(),
      thread: liveThread([turn([IMAGE_ATTACHMENT])], OTHER_THREAD_ID, OTHER_OWNER_ID),
    });

    expect(document.querySelector(".agent-lightbox")).toBeNull();
  });

  it("leaves imported session images as chips with no lightbox", () => {
    render({
      attachmentImages: readySurface(),
      thread: importedThread([
        importedExchange("user", "Look", [{ kind: "image", mime: "image/png" }]),
      ]),
    });

    expect(shell.querySelector(".agent-attachments__chip")).not.toBeNull();
    expect(shell.querySelector(".agent-attachments__open")).toBeNull();
    expect(document.querySelector(".agent-lightbox")).toBeNull();
  });

  function openLightbox(): void {
    act(() => thumbnail().click());
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
  }

  function thumbnail(): HTMLButtonElement {
    const button = shell.querySelector<HTMLButtonElement>(".agent-attachments__open");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function lightbox(): HTMLElement {
    const dialog = document.querySelector<HTMLElement>(".agent-lightbox");
    expect(dialog).not.toBeNull();
    return dialog as HTMLElement;
  }

  function closeControl(): HTMLButtonElement {
    const button = lightbox().querySelector<HTMLButtonElement>(
      `button[aria-label="${AGENT_LIGHTBOX_CLOSE_LABEL}"]`,
    );
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function scrollerChain(): ReadonlyArray<string> {
    const scroller = shell.querySelector(".agent-session__scroll");
    expect(scroller).not.toBeNull();
    const chain: string[] = [];
    for (let node = scroller; node !== null && node !== host; node = node.parentElement) {
      chain.push(`${node.tagName}.${node.className}|${node.getAttribute("style") ?? ""}`);
    }
    return chain;
  }

  function press(target: Element | null, key: string, init: KeyboardEventInit = {}): void {
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  }

  function pressMouse(target: Element | null): void {
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
  }

  function render(overrides: Partial<AgentThreadSessionProps>): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={600_000}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            markdownViewport={null}
            onReviewInDiff={() => undefined}
            thread={liveThread([turn([IMAGE_ATTACHMENT])])}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }
});

function readySurface(): AgentAttachmentImagesSurface {
  return surface({ kind: "ready", url: IMAGE_URL });
}

function surface(state: AgentAttachmentImageState): AgentAttachmentImagesSurface {
  const images = new Map<string, AgentAttachmentImageState>();
  images.set(agentAttachmentImageKey(OWNER_ID, THREAD_ID, IMAGE_ID), state);
  images.set(agentAttachmentImageKey(OTHER_OWNER_ID, OTHER_THREAD_ID, IMAGE_ID), state);
  return {
    images,
    ensure: () => undefined,
    holdThread: () => () => undefined,
    releaseWorkspace: () => undefined,
  };
}

function turn(attachments: ReadonlyArray<AgentAttachment>): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt: "Look at this",
    status: { kind: "exited", exitCode: 0 },
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

function liveThread(
  turns: ReadonlyArray<AgentTurn>,
  threadId = THREAD_ID,
  ownerId = OWNER_ID,
): AgentThreadView {
  return threadView(turns, null, threadId, ownerId);
}

function importedThread(exchanges: ReadonlyArray<ExternalSessionExchange>): AgentThreadView {
  return threadView(
    [],
    {
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
    },
    THREAD_ID,
    OWNER_ID,
  );
}

function threadView(
  turns: ReadonlyArray<AgentTurn>,
  externalOrigin: AgentThread["externalOrigin"],
  threadId: string,
  ownerId: string,
): AgentThreadView {
  const record: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId, repositoryRoot: ROOT },
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
