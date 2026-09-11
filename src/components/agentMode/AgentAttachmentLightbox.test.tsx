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
import {
  AGENT_LIGHTBOX_CLOSE_LABEL,
  AGENT_LIGHTBOX_NEXT_LABEL,
  AGENT_LIGHTBOX_PREVIOUS_LABEL,
  AGENT_LIGHTBOX_REVEAL_LABEL,
  AGENT_LIGHTBOX_SCRIM_LABEL,
} from "./AgentAttachmentLightbox";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const OTHER_OWNER_ID = "agent-root:other";
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const OTHER_THREAD_ID = "agt-2";
const IMAGE_ID = "a".repeat(32);
const SECOND_ID = "b".repeat(32);
const THIRD_ID = "c".repeat(32);
const IMAGE_URL = "blob:shot";
const SECOND_URL = "blob:second";
const THIRD_URL = "blob:third";

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
const SECOND_ATTACHMENT: AgentAttachment = {
  ...IMAGE_ATTACHMENT,
  attachmentId: SECOND_ID,
  name: "second.png",
  width: 400,
  height: 300,
  storedPath: `/data/agent-attachments/threads/${THREAD_ID}/${SECOND_ID}.png`,
};
const THIRD_ATTACHMENT: AgentAttachment = {
  ...IMAGE_ATTACHMENT,
  attachmentId: THIRD_ID,
  name: "third.png",
  storedPath: `/data/agent-attachments/threads/${THREAD_ID}/${THIRD_ID}.png`,
};

describe("agent attachment lightbox", () => {
  let host: HTMLDivElement;
  let shell: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    shell = document.createElement("div");
    shell.className = "workbench-frame";
    host.append(shell);
    document.body.append(host);
    root = createRoot(shell);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens the clicked image inside the workbench frame token scope from the same object URL, outside the transcript", () => {
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
    expect(image?.style.maxWidth).toBe("min(92vw, 800px)");
    expect(image?.style.maxHeight).toBe("min(86vh, 600px)");
    expect(
      image
        ?.closest(".agent-lightbox__frame")
        ?.parentElement?.classList.contains("agent-lightbox__stage"),
    ).toBe(true);
    expect(document.querySelectorAll(".agent-lightbox")).toHaveLength(1);
    expect(scrollerChain()).toEqual(chainBefore);
    expect(document.body.className).toBe("");
    expect(onRevealAttachment).not.toHaveBeenCalled();
  });

  it("shows the close control first in the tab order and focuses it on open", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();

    const buttons = tabbableControls();
    expect(buttons.map(accessibleName)).toEqual([
      AGENT_LIGHTBOX_CLOSE_LABEL,
      AGENT_LIGHTBOX_REVEAL_LABEL,
    ]);
    expect(buttons[0]?.hidden).toBe(false);
    expect(buttons[0]?.querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe(buttons[0]);
    expect(lightbox().querySelector("button")).toBe(buttons[0]);
    expect(lightbox().lastElementChild).toBe(scrimControl());
  });

  it("keeps the close control inside the image frame, over the image, and focused on open", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();

    const frame = lightbox().querySelector<HTMLElement>(".agent-lightbox__frame");
    expect(frame).not.toBeNull();
    const image = frame?.querySelector(".agent-lightbox__image");
    expect(image).not.toBeNull();
    const close = closeControl();
    expect(frame?.contains(close)).toBe(true);
    expect(
      close.compareDocumentPosition(image as Node) & Node.DOCUMENT_POSITION_PRECEDING,
    ).not.toBe(0);
    expect(close.classList.contains("agent-lightbox__close")).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(lightbox().querySelector(".agent-lightbox__controls")).toBeNull();
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

  it("closes from the scrim button but not from a click on the image or the caption", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    click(lightbox().querySelector(".agent-lightbox__image"));
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
    click(lightbox().querySelector(".agent-lightbox__name"));
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
    click(lightbox().querySelector(".agent-lightbox__frame"));
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();

    const scrim = scrimControl();
    expect(scrim.tagName).toBe("BUTTON");
    expect(scrim.getAttribute("type")).toBe("button");
    expect(scrim.tabIndex).toBe(-1);
    expect(scrim.parentElement).toBe(lightbox());
    expect(scrim.previousElementSibling?.classList.contains("agent-lightbox__stage")).toBe(true);
    expect(scrim.childElementCount).toBe(0);
    click(scrim);

    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("keeps Tab inside the close and open-in-viewer controls", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    const [close, reveal] = tabbableControls();
    expect(close).toBeDefined();
    expect(reveal).toBeDefined();

    focus(reveal ?? null);
    press(reveal ?? null, "Tab");
    expect(document.activeElement).toBe(close);

    press(close ?? null, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(reveal);

    focus(lightbox());
    press(lightbox(), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(reveal);

    focus(lightbox());
    press(lightbox(), "Tab");
    expect(document.activeElement).toBe(close);

    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
  });

  it("cycles Tab through close, open-in-viewer, previous and next when the turn has several images", () => {
    render({
      attachmentImages: surfaceOf({ [IMAGE_ID]: ready(IMAGE_URL), [SECOND_ID]: ready(SECOND_URL) }),
      thread: liveThread([turn([IMAGE_ATTACHMENT, SECOND_ATTACHMENT])]),
    });

    openLightbox();
    const controls = tabbableControls();
    expect(controls.map(accessibleName)).toEqual([
      AGENT_LIGHTBOX_CLOSE_LABEL,
      AGENT_LIGHTBOX_REVEAL_LABEL,
      AGENT_LIGHTBOX_PREVIOUS_LABEL,
      AGENT_LIGHTBOX_NEXT_LABEL,
    ]);
    const [close, reveal, previous, next] = controls;

    focus(next ?? null);
    press(next ?? null, "Tab");
    expect(document.activeElement).toBe(close);

    press(close ?? null, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(next);

    focus(reveal ?? null);
    press(reveal ?? null, "Tab");
    expect(document.activeElement).toBe(reveal);

    focus(previous ?? null);
    press(previous ?? null, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(previous);
  });

  it("names the image in the caption and opens the system viewer from there with ids only", () => {
    const onRevealAttachment = vi.fn();
    render({ attachmentImages: readySurface(), onRevealAttachment });

    openLightbox();
    const caption = lightbox().querySelector<HTMLElement>(".agent-lightbox__caption");
    expect(caption).not.toBeNull();
    expect(caption?.closest(".agent-lightbox__stage")).not.toBeNull();
    expect(caption?.querySelector(".agent-lightbox__name")?.textContent).toBe("shot.png");
    const reveal = caption?.querySelector<HTMLButtonElement>(".agent-lightbox__reveal");
    expect(reveal).not.toBeNull();
    expect(reveal?.textContent).toBe(AGENT_LIGHTBOX_REVEAL_LABEL);
    expect(reveal?.hasAttribute("aria-label")).toBe(false);
    click(reveal ?? null);

    expect(onRevealAttachment).toHaveBeenCalledTimes(1);
    expect(onRevealAttachment).toHaveBeenCalledWith(THREAD_ID, IMAGE_ID);
    expect(document.querySelector(".agent-lightbox")).not.toBeNull();
  });

  it("renders no chevrons for a turn with a single image", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();

    expect(previousControl()).toBeNull();
    expect(nextControl()).toBeNull();
    press(closeControl(), "ArrowRight");
    expect(lightbox().getAttribute("aria-label")).toBe("shot.png");
  });

  it("steps between two ready images with the chevrons and arrow keys, clamped at the ends", () => {
    render({
      attachmentImages: surfaceOf({ [IMAGE_ID]: ready(IMAGE_URL), [SECOND_ID]: ready(SECOND_URL) }),
      thread: liveThread([turn([IMAGE_ATTACHMENT, SECOND_ATTACHMENT])]),
    });

    openLightbox();
    expectShown("shot.png", IMAGE_URL, "800", "600");
    expect(previousControl()?.getAttribute("aria-disabled")).toBe("true");
    expect(nextControl()?.getAttribute("aria-disabled")).toBe("false");

    press(closeControl(), "ArrowLeft");
    expectShown("shot.png", IMAGE_URL, "800", "600");

    press(closeControl(), "ArrowRight");
    expectShown("second.png", SECOND_URL, "400", "300");
    expect(previousControl()?.getAttribute("aria-disabled")).toBe("false");
    expect(nextControl()?.getAttribute("aria-disabled")).toBe("true");
    expect(
      lightbox().querySelector<HTMLImageElement>(".agent-lightbox__image")?.style.maxWidth,
    ).toBe("min(92vw, 400px)");

    press(closeControl(), "ArrowRight");
    expectShown("second.png", SECOND_URL, "400", "300");

    focus(nextControl());
    click(nextControl());
    expectShown("second.png", SECOND_URL, "400", "300");
    expect(document.activeElement).toBe(nextControl());

    click(previousControl());
    expectShown("shot.png", IMAGE_URL, "800", "600");

    click(previousControl());
    expectShown("shot.png", IMAGE_URL, "800", "600");

    press(closeControl(), "Escape");
    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("skips a sibling whose cache entry is not ready", () => {
    render({
      attachmentImages: surfaceOf({
        [IMAGE_ID]: ready(IMAGE_URL),
        [SECOND_ID]: { kind: "loading" },
        [THIRD_ID]: ready(THIRD_URL),
      }),
      thread: liveThread([turn([IMAGE_ATTACHMENT, SECOND_ATTACHMENT, THIRD_ATTACHMENT])]),
    });

    openLightbox();
    expectShown("shot.png", IMAGE_URL, "800", "600");

    press(closeControl(), "ArrowRight");
    expectShown("third.png", THIRD_URL, "800", "600");
    expect(nextControl()?.getAttribute("aria-disabled")).toBe("true");

    press(closeControl(), "ArrowLeft");
    expectShown("shot.png", IMAGE_URL, "800", "600");
  });

  it("skips a sibling whose bytes failed to decode in the transcript", () => {
    render({
      attachmentImages: surfaceOf({
        [IMAGE_ID]: ready(IMAGE_URL),
        [SECOND_ID]: ready(SECOND_URL),
        [THIRD_ID]: ready(THIRD_URL),
      }),
      thread: liveThread([turn([IMAGE_ATTACHMENT, SECOND_ATTACHMENT, THIRD_ATTACHMENT])]),
    });
    const secondThumbnail = thumbnails()[1]?.querySelector("img") ?? null;
    expect(secondThumbnail?.getAttribute("src")).toBe(SECOND_URL);
    act(() => {
      secondThumbnail?.dispatchEvent(new Event("error"));
    });
    expect(thumbnails()).toHaveLength(2);
    expect(shell.querySelector("[data-agent-attachment='unavailable']")).not.toBeNull();

    openLightbox();
    expectShown("shot.png", IMAGE_URL, "800", "600");

    press(closeControl(), "ArrowRight");
    expectShown("third.png", THIRD_URL, "800", "600");
    expect(nextControl()?.getAttribute("aria-disabled")).toBe("true");

    press(closeControl(), "ArrowLeft");
    expectShown("shot.png", IMAGE_URL, "800", "600");
    expect(previousControl()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("closes instead of showing an empty frame when the lightbox image fails to decode", () => {
    render({ attachmentImages: readySurface() });

    openLightbox();
    act(() => {
      lightbox().querySelector(".agent-lightbox__image")?.dispatchEvent(new Event("error"));
    });

    expect(document.querySelector(".agent-lightbox")).toBeNull();
    expect(document.activeElement).toBe(thumbnail());
  });

  it("shows only the previous chevron as available when every later sibling is still loading", () => {
    render({
      attachmentImages: surfaceOf({
        [IMAGE_ID]: ready(IMAGE_URL),
        [SECOND_ID]: ready(SECOND_URL),
        [THIRD_ID]: { kind: "loading" },
      }),
      thread: liveThread([turn([IMAGE_ATTACHMENT, SECOND_ATTACHMENT, THIRD_ATTACHMENT])]),
    });

    act(() => thumbnails()[1]?.click());
    expectShown("second.png", SECOND_URL, "400", "300");
    expect(previousControl()?.getAttribute("aria-disabled")).toBe("false");
    expect(nextControl()?.getAttribute("aria-disabled")).toBe("true");

    press(closeControl(), "ArrowRight");
    expectShown("second.png", SECOND_URL, "400", "300");

    press(closeControl(), "Escape");
    expect(document.activeElement).toBe(thumbnails()[1]);
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

  function thumbnails(): ReadonlyArray<HTMLButtonElement> {
    return [...shell.querySelectorAll<HTMLButtonElement>(".agent-attachments__open")];
  }

  function tabbableControls(): ReadonlyArray<HTMLButtonElement> {
    return [...lightbox().querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.tabIndex !== -1,
    );
  }

  function accessibleName(button: HTMLButtonElement): string {
    return button.getAttribute("aria-label") ?? button.textContent ?? "";
  }

  function focus(target: Element | null): void {
    expect(target).not.toBeNull();
    act(() => {
      (target as HTMLElement).focus();
    });
    expect(document.activeElement).toBe(target);
  }

  function scrimControl(): HTMLButtonElement {
    const button = lightbox().querySelector<HTMLButtonElement>(
      `button[aria-label="${AGENT_LIGHTBOX_SCRIM_LABEL}"]`,
    );
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function previousControl(): HTMLButtonElement | null {
    return lightbox().querySelector<HTMLButtonElement>(
      `button[aria-label="${AGENT_LIGHTBOX_PREVIOUS_LABEL}"]`,
    );
  }

  function nextControl(): HTMLButtonElement | null {
    return lightbox().querySelector<HTMLButtonElement>(
      `button[aria-label="${AGENT_LIGHTBOX_NEXT_LABEL}"]`,
    );
  }

  function expectShown(name: string, url: string, width: string, height: string): void {
    const dialog = lightbox();
    expect(dialog.getAttribute("aria-label")).toBe(name);
    const image = dialog.querySelector<HTMLImageElement>(".agent-lightbox__image");
    expect(image?.getAttribute("src")).toBe(url);
    expect(image?.alt).toBe(name);
    expect(image?.getAttribute("width")).toBe(width);
    expect(image?.getAttribute("height")).toBe(height);
    expect(dialog.querySelector(".agent-lightbox__name")?.textContent).toBe(name);
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

  function click(target: Element | null): void {
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
  return surface(ready(IMAGE_URL));
}

function ready(url: string): AgentAttachmentImageState {
  return { kind: "ready", url };
}

function surface(state: AgentAttachmentImageState): AgentAttachmentImagesSurface {
  return surfaceOf({ [IMAGE_ID]: state });
}

function surfaceOf(
  states: Readonly<Record<string, AgentAttachmentImageState>>,
): AgentAttachmentImagesSurface {
  const images = new Map<string, AgentAttachmentImageState>();
  for (const [attachmentId, state] of Object.entries(states)) {
    images.set(agentAttachmentImageKey(OWNER_ID, THREAD_ID, attachmentId), state);
    images.set(agentAttachmentImageKey(OTHER_OWNER_ID, OTHER_THREAD_ID, attachmentId), state);
  }
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
