// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
