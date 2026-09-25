// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  AgentQueuedPrompt,
  AGENT_QUEUED_NEXT_TURN_NOTICE,
  AGENT_QUEUED_UNCERTAIN_NOTICE,
} from "./AgentQueuedPrompt";

it("retains uncertain messages without allowing edit or duplicate send", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onEdit = vi.fn();
  const onSendNow = vi.fn();
  const onRemove = vi.fn();
  try {
    act(() =>
      root.render(
        <AgentQueuedPrompt
          id="q-1"
          prompt="Inspect it"
          state="uncertain"
          onEdit={onEdit}
          onSendNow={onSendNow}
          onRemove={onRemove}
        />,
      ),
    );
    expect(host.textContent).toContain(AGENT_QUEUED_UNCERTAIN_NOTICE);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')?.disabled,
    ).toBe(true);
    expect(host.querySelector('[aria-label="Send queued message now"]')).toBeNull();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')!.click(),
    );
    expect(onRemove).toHaveBeenCalledWith("q-1");
    expect(onEdit).not.toHaveBeenCalled();
    expect(onSendNow).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});

it("shows a message held for the next turn and still lets the user retry send now", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onEdit = vi.fn();
  const onSendNow = vi.fn();
  try {
    act(() =>
      root.render(
        <AgentQueuedPrompt
          id="q-1"
          prompt="Inspect it"
          state="next"
          onEdit={onEdit}
          onSendNow={onSendNow}
          onRemove={vi.fn()}
        />,
      ),
    );
    const status = host.querySelector(".agent-prompt__queue-status");
    expect(status?.textContent).toBe("Next");
    expect(status?.getAttribute("title")).toBe(AGENT_QUEUED_NEXT_TURN_NOTICE);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click());
    expect(onEdit).toHaveBeenCalledWith("q-1");
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Send queued message now"]')!.click(),
    );
    expect(onSendNow).toHaveBeenCalledWith("q-1");
  } finally {
    act(() => root.unmount());
  }
});
