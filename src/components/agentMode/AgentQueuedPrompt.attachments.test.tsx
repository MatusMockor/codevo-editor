// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { AgentTurnAttachmentIntent } from "../../application/agentThreadPorts";
import { AgentQueuedPrompt } from "./AgentQueuedPrompt";

const QUEUED_FILE: AgentTurnAttachmentIntent = {
  kind: "staged",
  attachmentId: "b".repeat(32),
  name: "report.pdf",
  bytes: 5_000_000,
  mime: null,
  width: null,
  height: null,
};

const QUEUED_IMAGE: AgentTurnAttachmentIntent = {
  kind: "staged",
  attachmentId: "a".repeat(32),
  name: "shot.png",
  bytes: 2_048,
  mime: "image/png",
  width: 40,
  height: 20,
};

it("counts a queued file as an attachment and names it without calling it an image", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <AgentQueuedPrompt
          attachments={[QUEUED_FILE]}
          id="q-1"
          onRemove={() => undefined}
          prompt="Use the report"
        />,
      ),
    );
    const summary = host.querySelector<HTMLElement>(".agent-prompt__queue-attachments");
    expect(summary?.textContent).toBe("1 attachment");
    expect(summary?.title).toBe("report.pdf");
    expect(host.textContent).not.toMatch(/image/i);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".agent-attachments__download")).toBeNull();

    act(() =>
      root.render(
        <AgentQueuedPrompt
          attachments={[QUEUED_FILE, QUEUED_IMAGE]}
          id="q-1"
          onRemove={() => undefined}
          prompt="Use the report"
        />,
      ),
    );
    const both = host.querySelector<HTMLElement>(".agent-prompt__queue-attachments");
    expect(both?.textContent).toBe("2 attachments");
    expect(both?.title).toBe("report.pdf, shot.png");
  } finally {
    act(() => root.unmount());
  }
});
