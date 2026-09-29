// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import { AgentNoticeBar } from "./AgentNoticeBar";

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

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === name);
}

describe("AgentNoticeBar", () => {
  it("offers restarting and sending the exact refused queued message", () => {
    const onRestartFollowUp = vi.fn();
    const notice: AgentTasksNotice = {
      kind: "error",
      message: "Queued messages are paused.",
      action: { kind: "restartFollowUp", threadId: "agt-1", entryId: "queued-1" },
    };
    act(() =>
      root.render(
        <AgentNoticeBar
          notice={notice}
          onConfigure={vi.fn()}
          onDismiss={vi.fn()}
          onRestartFollowUp={onRestartFollowUp}
        />,
      ),
    );
    const restart = buttonNamed("Restart and send");
    expect(restart).toBeInstanceOf(HTMLButtonElement);
    act(() => restart?.click());
    expect(onRestartFollowUp).toHaveBeenCalledWith({
      kind: "restartFollowUp",
      threadId: "agt-1",
      entryId: "queued-1",
    });
  });

  it("opens agent settings for the configure action and offers no restart", () => {
    const onConfigure = vi.fn();
    act(() =>
      root.render(
        <AgentNoticeBar
          notice={{ kind: "error", message: "Set the CLI.", action: "configure-agent-cli" }}
          onConfigure={onConfigure}
          onDismiss={vi.fn()}
          onRestartFollowUp={vi.fn()}
        />,
      ),
    );
    const settings = host.querySelector<HTMLButtonElement>('[aria-label="Open agent settings"]');
    expect(settings).toBeInstanceOf(HTMLButtonElement);
    act(() => settings?.click());
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(buttonNamed("Restart and send")).toBeUndefined();
  });

  it("offers no restart when no restart handler is wired", () => {
    act(() =>
      root.render(
        <AgentNoticeBar
          notice={{
            kind: "error",
            message: "Queued messages are paused.",
            action: { kind: "restartFollowUp", threadId: "agt-1", entryId: "queued-1" },
          }}
          onConfigure={vi.fn()}
          onDismiss={vi.fn()}
        />,
      ),
    );
    expect(buttonNamed("Restart and send")).toBeUndefined();
    expect(host.querySelector('[aria-label="Open agent settings"]')).toBeNull();
  });

  it("shows no restart action for other notices", () => {
    act(() =>
      root.render(
        <AgentNoticeBar
          notice={{ kind: "info", message: "Hello", action: null }}
          onConfigure={vi.fn()}
          onDismiss={vi.fn()}
          onRestartFollowUp={vi.fn()}
        />,
      ),
    );
    expect(buttonNamed("Restart and send")).toBeUndefined();
  });
});
