// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { AgentPendingSend } from "../agentPendingSend";
import { AgentPendingUserMessage } from "./AgentPendingUserMessage";

const IMAGE_ID = "0123456789abcdef0123456789abcdef";

function pending(status: AgentPendingSend["status"]): AgentPendingSend {
  return {
    id: 1,
    target: { kind: "followUp", threadId: "agt-1", baseTurnId: null },
    prompt: "Look at this",
    attachments: [
      {
        view: {
          kind: "image",
          key: "d1",
          name: "shot.png",
          attachmentId: IMAGE_ID,
          mime: "image/png",
          width: 40,
          height: 20,
        },
        previewUrl: "blob:preview-1",
      },
      { view: { kind: "chip", key: "d2", name: "notes.txt", glyph: "file" }, previewUrl: null },
    ],
    sentAtEpochMs: 1_700_000_000_000,
    status,
  };
}

describe("AgentPendingUserMessage", () => {
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

  function renderPending(status: AgentPendingSend["status"], provider?: AgentCliKind): void {
    act(() =>
      root.render(
        <AgentPendingUserMessage
          openExternalLink={null}
          onDismiss={() => undefined}
          provider={provider}
          send={pending(status)}
          textClipboard={null}
        />,
      ),
    );
  }

  function announcedStatuses(): ReadonlyArray<string | null> {
    return [...host.querySelectorAll('[role="status"]')]
      .filter((status) => status.closest('[aria-hidden="true"]') === null)
      .map((status) => status.textContent);
  }

  it("shows the waiting indicator under a message that is still sending", () => {
    renderPending("sending");

    const indicator = host.querySelector(
      ".agent-prompt + .agent-answer > .agent-turn__events > .agent-note",
    );
    expect(indicator?.textContent).toBe("Waiting for output…");
    expect(indicator?.querySelector(".agent-well__caret")).not.toBeNull();
    expect(host.querySelectorAll(".agent-answer")).toHaveLength(1);
  });

  it("matches a pending Codex turn with its startup note", () => {
    renderPending("sending", "codex");

    expect(host.querySelector(".agent-prompt + .agent-answer > .agent-note")?.textContent).toBe(
      "Starting Codex…",
    );
    expect(host.textContent).not.toContain("Waiting for output");
  });

  it("announces a sending message exactly once", () => {
    renderPending("sending");
    expect(announcedStatuses()).toEqual(["Sending"]);

    renderPending("sending", "codex");
    expect(announcedStatuses()).toEqual(["Sending"]);
  });

  it("shows no working indicator for a message that was not sent", () => {
    renderPending("failed");
    expect(host.querySelector(".agent-answer")).toBeNull();
    expect(host.textContent).not.toContain("Waiting for output");
    expect(announcedStatuses()).toEqual([]);

    renderPending("failed", "codex");
    expect(host.querySelector(".agent-answer")).toBeNull();
    expect(host.textContent).not.toContain("Starting Codex");
  });

  it("renders the sent text and the local preview thumbnails at once", () => {
    act(() =>
      root.render(
        <AgentPendingUserMessage
          openExternalLink={null}
          onDismiss={() => undefined}
          send={pending("sending")}
          textClipboard={null}
        />,
      ),
    );
    const bubbles = host.querySelectorAll(".agent-prompt__bubble");
    expect(bubbles).toHaveLength(1);
    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe("Look at this");
    expect(host.querySelector<HTMLImageElement>(".agent-attachments__image")?.src).toBe(
      "blob:preview-1",
    );
    expect(host.querySelector(".agent-attachments__chip")?.textContent).toContain("notes.txt");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Sending");
  });

  it("says truthfully that a failed message was not sent and can be dismissed", () => {
    const dismiss = vi.fn();
    act(() =>
      root.render(
        <AgentPendingUserMessage
          openExternalLink={null}
          onDismiss={dismiss}
          send={pending("failed")}
          textClipboard={null}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Not sent. Your message is back in the composer.",
    );
    expect(host.querySelector(".agent-turn")?.getAttribute("data-pending-send")).toBe("failed");
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss unsent message"]')?.click(),
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
