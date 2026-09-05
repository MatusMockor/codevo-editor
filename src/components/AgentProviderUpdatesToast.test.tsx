// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentProviderUpdateToastView } from "./agentProviderUpdateToastPresenter";
import {
  AGENT_PROVIDER_UPDATED_TOAST_VISIBLE_MS,
  AgentProviderUpdatesToast,
  type AgentProviderUpdatesToastProps,
} from "./AgentProviderUpdatesToast";

const CODEX = createAgentProviderUpdateToastView("codex", "0.153.4", undefined, {
  installedVersion: "0.152.0",
  installer: "npm",
})!;
const CLAUDE = createAgentProviderUpdateToastView("claudeCode", "2.1.0", undefined, {
  installedVersion: "2.0.0",
  installer: "homebrew",
})!;

describe("AgentProviderUpdatesToast", () => {
  let host: HTMLDivElement;
  let root: Root;
  let handlers: Omit<AgentProviderUpdatesToastProps, "presentation">;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    handlers = {
      onCopyError: vi.fn(),
      onDismiss: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onUpdateAll: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = (presentation: AgentProviderUpdatesToastProps["presentation"]) => {
    act(() => {
      root.render(<AgentProviderUpdatesToast {...handlers} presentation={presentation} />);
    });
  };

  it("merges several providers into one toast with an update-all action", () => {
    render({ kind: "availableMany", views: [CODEX, CLAUDE] });

    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Updates Available: 2 providers",
    );
    expect(host.textContent).toContain("Codex v0.153.4");
    expect(host.textContent).toContain("Claude Code v2.1.0");
    expect(host.textContent).toContain("Homebrew");

    act(() => button("Update all").click());
    expect(handlers.onUpdateAll).toHaveBeenCalledWith([CODEX, CLAUDE]);

    act(() => button("Settings").click());
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows the running update without actions", () => {
    render({ kind: "updating", provider: "codex", operationId: "op-1" });

    expect(host.querySelector(".toast-notification--loading")?.textContent).toContain(
      "Updating provider",
    );
    expect(host.textContent).toContain("Running provider update command.");
    expect(host.querySelectorAll(".toast-notification-action")).toHaveLength(0);
  });

  it("auto-hides the success toast after the bounded delay and cleans the timer on unmount", () => {
    render({ kind: "updated", provider: "codex", version: CODEX.availableVersion });

    expect(host.querySelector(".toast-notification--success")?.textContent).toContain(
      "Codex updated: v0.153.4",
    );
    act(() => {
      vi.advanceTimersByTime(AGENT_PROVIDER_UPDATED_TOAST_VISIBLE_MS - 1);
    });
    expect(handlers.onDismiss).not.toHaveBeenCalled();

    const latestDismiss = vi.fn();
    act(() => {
      root.render(
        <AgentProviderUpdatesToast
          {...handlers}
          onDismiss={latestDismiss}
          presentation={{ kind: "updated", provider: "codex", version: CODEX.availableVersion }}
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(handlers.onDismiss).not.toHaveBeenCalled();
    expect(latestDismiss).toHaveBeenCalledOnce();

    render({ kind: "updated", provider: "claudeCode", version: CLAUDE.availableVersion });
    act(() => root.unmount());
    root = createRoot(host);
    act(() => {
      vi.advanceTimersByTime(AGENT_PROVIDER_UPDATED_TOAST_VISIBLE_MS);
    });
    expect(latestDismiss).toHaveBeenCalledOnce();
    expect(handlers.onDismiss).not.toHaveBeenCalled();
  });

  it("offers copy, settings, and retry for a failed update", () => {
    render({
      kind: "failed",
      provider: "codex",
      reason: "exited",
      outputTail: "npm ERR! code 1",
      installedVersion: "0.152.0",
      retryVersion: CODEX.availableVersion,
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Provider update failed");
    expect(host.textContent).toContain("The installer exited with an error.");
    expect(host.textContent).toContain("still on v0.152.0");

    act(() => button("Copy error").click());
    expect(handlers.onCopyError).toHaveBeenCalledWith(
      "Codex update failed: The installer exited with an error.\nnpm ERR! code 1",
    );
    act(() => button("Retry").click());
    expect(handlers.onRetry).toHaveBeenCalledWith("codex", "0.153.4");
  });

  it("hides retry when no exact offered version can be retried", () => {
    render({
      kind: "failed",
      provider: "claudeCode",
      reason: null,
      outputTail: "",
      installedVersion: null,
      retryVersion: null,
    });

    expect(buttons()).toEqual(["Copy error", "Settings"]);
  });

  it("explains a refused update and routes to settings", () => {
    render({
      kind: "refused",
      provider: "codex",
      version: CODEX.availableVersion,
      refusal: "turnActive",
    });

    expect(host.querySelector(".toast-notification--warning")?.textContent).toContain(
      "Provider update not started",
    );
    expect(host.textContent).toContain(
      "Codex v0.153.4 was not updated. A provider turn is running.",
    );
    expect(buttons()).toEqual(["Settings"]);
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')?.click(),
    );
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  function buttons(): string[] {
    return Array.from(host.querySelectorAll(".toast-notification-action")).map(
      (element) => element.textContent ?? "",
    );
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }
});
