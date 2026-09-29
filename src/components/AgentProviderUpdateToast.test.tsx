// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchNotice } from "../application/workbenchNotice";
import type { AgentCliKind } from "../domain/agentSettings";
import {
  agentProviderUpdateNoticeGroupKey,
  createAgentProviderUpdateToastView,
  type AgentProviderUpdateVersion,
} from "./agentProviderUpdateToastPresenter";
import {
  agentProviderUpdateToastRenderer,
  type AgentProviderUpdateToastCallbacks,
} from "./agentProviderUpdateToastRenderer";

const VIEW = createAgentProviderUpdateToastView("codex", "0.150.1")!;

describe("agent provider update toast", () => {
  let callbacks: AgentProviderUpdateToastCallbacks;
  let dismiss: ReturnType<typeof vi.fn<() => void>>;
  let host: HTMLDivElement;
  let onDismiss: ReturnType<
    typeof vi.fn<(provider: AgentCliKind, version: AgentProviderUpdateVersion) => Promise<boolean>>
  >;
  let onOpenSettings: ReturnType<typeof vi.fn<() => void>>;
  let onUpdate: ReturnType<
    typeof vi.fn<(provider: AgentCliKind, version: AgentProviderUpdateVersion) => Promise<boolean>>
  >;
  let root: Root;

  beforeEach(() => {
    onDismiss = vi.fn().mockResolvedValue(true);
    onOpenSettings = vi.fn();
    onUpdate = vi.fn().mockResolvedValue(true);
    callbacks = {
      onDismiss,
      onOpenSettings,
      onUpdate,
    };
    dismiss = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("registers only the exact provider and offered version", () => {
    expect(agentProviderUpdateToastRenderer({ callbacks, view: null })).toBeNull();
    expect(agentProviderUpdateToastRenderer({ callbacks, view: VIEW })?.[0]).toBe(
      agentProviderUpdateNoticeGroupKey("codex", "0.150.1"),
    );
    expect(agentProviderUpdateNoticeGroupKey("codex", "0.150.1")).not.toBe(
      agentProviderUpdateNoticeGroupKey("codex", "0.150.2"),
    );
    expect(agentProviderUpdateNoticeGroupKey("codex", "0.150.1")).not.toBe(
      agentProviderUpdateNoticeGroupKey("claudeCode", "0.150.1"),
    );
  });

  it("fails closed for malformed, normalized, and oversized versions", () => {
    expect(createAgentProviderUpdateToastView("codex", "not-a-version")).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", " 0.150.1 ")).toBeNull();
    expect(createAgentProviderUpdateToastView("codex", `1.${"0".repeat(300)}`)).toBeNull();
  });

  it("renders the typed view without parsing the notice message", async () => {
    const [groupKey, renderer] = agentProviderUpdateToastRenderer({ callbacks, view: VIEW })!;
    const notice = createWorkbenchNotice(
      "info",
      "Ignored",
      "Update available: Claude Code v999.999.999",
      groupKey,
    );

    await act(async () => {
      root.render(<>{renderer(notice, { dismiss })}</>);
    });

    expect(host.querySelector(".toast-notification__title")?.textContent).toBe("Update available");
    expect(rows()).toEqual([{ provider: "Codex", note: null, version: "v0.150.1" }]);
    expect(host.textContent).not.toContain("Claude Code");
    expect(host.textContent).not.toContain("999.999.999");
    expect(host.querySelector(".toast-notification__badge--update")).not.toBeNull();
    expect(host.querySelector(".toast-notification__badge--manual")).toBeNull();
    expect(button("Settings")).not.toBeUndefined();
    expect(button("Update")).not.toBeUndefined();
    expect(button("Copy command")).toBeUndefined();
  });

  it("shows the installed and offered versions in one row without installer noise", async () => {
    const view = createAgentProviderUpdateToastView("codex", "0.153.4", undefined, "0.152.0")!;
    const [groupKey, renderer] = agentProviderUpdateToastRenderer({ callbacks, view })!;

    await act(async () => {
      root.render(
        <>
          {renderer(createWorkbenchNotice("info", "Agent provider", "ignored", groupKey), {
            dismiss,
          })}
        </>,
      );
    });

    expect(rows()).toEqual([{ provider: "Codex", note: null, version: "v0.152.0 to v0.153.4" }]);
    expect(host.querySelector(".toast-notification__meta")).toBeNull();
    expect(host.querySelector("code")).toBeNull();
    expect(host.textContent).not.toContain("built-in updater");
    expect(host.querySelector(".toast-notification-message")).toBeNull();
  });

  it("shows only the offered version when the installed version is unknown", async () => {
    const view = createAgentProviderUpdateToastView("codex", "0.153.4", undefined, null)!;
    const [groupKey, renderer] = agentProviderUpdateToastRenderer({ callbacks, view })!;

    await act(async () => {
      root.render(
        <>
          {renderer(createWorkbenchNotice("info", "Agent provider", "ignored", groupKey), {
            dismiss,
          })}
        </>,
      );
    });

    expect(rows()).toEqual([{ provider: "Codex", note: null, version: "v0.153.4" }]);
  });

  it("fails closed for stale versions and foreign providers", () => {
    const [, renderer] = agentProviderUpdateToastRenderer({ callbacks, view: VIEW })!;
    const staleVersion = createWorkbenchNotice(
      "info",
      "Agent provider",
      "ignored",
      agentProviderUpdateNoticeGroupKey("codex", "0.150.0"),
    );
    const foreignProvider = createWorkbenchNotice(
      "info",
      "Agent provider",
      "ignored",
      agentProviderUpdateNoticeGroupKey("claudeCode", "0.150.1"),
    );

    expect(renderer(staleVersion, { dismiss })).toBeNull();
    expect(renderer(foreignProvider, { dismiss })).toBeNull();
  });

  it.each([
    ["claudeCode", "Claude Code", "npm i -g @anthropic-ai/claude-code"],
    ["codex", "Codex", "npm i -g @openai/codex"],
  ] as const)(
    "routes a manual %s update to settings and offers its command",
    async (provider, label, command) => {
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const view = createAgentProviderUpdateToastView(provider, "1.2.3", true, "1.2.2")!;
      const [groupKey, renderer] = agentProviderUpdateToastRenderer({ callbacks, view })!;
      await act(async () => {
        root.render(
          <>
            {renderer(createWorkbenchNotice("info", "Agent provider", "ignored", groupKey), {
              dismiss,
            })}
          </>,
        );
      });

      expect(host.querySelector(".toast-notification__title")?.textContent).toBe(
        "Update available",
      );
      expect(host.textContent).toContain(`${label} can be updated from provider settings.`);
      expect(rows()).toEqual([
        { provider: label, note: "Manual update", version: "v1.2.2 to v1.2.3" },
      ]);
      expect(host.querySelector(".toast-notification__badge--manual")).not.toBeNull();
      expect(button("Update")).toBeUndefined();

      const copy = button("Copy command");
      expect(copy?.classList.contains("toast-notification-action--leading")).toBe(true);
      expect(copy?.classList.contains("toast-notification-action--ghost")).toBe(true);
      expect(actionLabels()).toEqual(["Copy command", "Settings"]);
      await click(copy);
      expect(writeText).toHaveBeenCalledWith(command);
      expect(dismiss).not.toHaveBeenCalled();

      await click(button("Settings"));
      expect(onOpenSettings).toHaveBeenCalledOnce();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );

  it("opens provider settings before locally dismissing the toast", async () => {
    await renderToast();

    await click(button("Settings"));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onOpenSettings.mock.invocationCallOrder[0]).toBeLessThan(
      dismiss.mock.invocationCallOrder[0],
    );
  });

  it("starts the exact offered update before locally dismissing the toast", async () => {
    await renderToast();

    await click(button("Update"));

    expect(onUpdate).toHaveBeenCalledWith("codex", "0.150.1");
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.invocationCallOrder[0]).toBeLessThan(dismiss.mock.invocationCallOrder[0]);
  });

  it("keeps the toast visible when the exact update is refused or rejects", async () => {
    onUpdate.mockResolvedValue(false);
    await renderToast();

    await click(button("Update"));

    expect(dismiss).not.toHaveBeenCalled();

    onUpdate.mockRejectedValue(new Error("update failed"));
    await click(button("Update"));

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("persists the exact dismissal before locally dismissing the toast", async () => {
    let settlePersistence: ((succeeded: boolean) => void) | null = null;
    onDismiss.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settlePersistence = resolve;
        }),
    );
    await renderToast();

    await click(host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]'));

    expect(onDismiss).toHaveBeenCalledWith("codex", "0.150.1");
    expect(dismiss).not.toHaveBeenCalled();

    await act(async () => settlePersistence?.(true));

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the toast visible when exact dismissal persistence fails", async () => {
    onDismiss.mockResolvedValue(false);
    await renderToast();

    await click(host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]'));

    expect(onDismiss).toHaveBeenCalledWith("codex", "0.150.1");
    expect(dismiss).not.toHaveBeenCalled();

    onDismiss.mockRejectedValue(new Error("save failed"));
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]'));

    expect(dismiss).not.toHaveBeenCalled();
  });

  function accessibleText(element: Element | null): string {
    if (element === null) return "";
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function rows(): { provider: string; note: string | null; version: string }[] {
    return [...host.querySelectorAll(".toast-update-row")].map((row) => ({
      provider: row.querySelector(".toast-update-row__provider")?.textContent ?? "",
      note: row.querySelector(".toast-update-row__note")?.textContent ?? null,
      version: accessibleText(row.querySelector(".toast-update-row__version")),
    }));
  }

  function actionLabels(): string[] {
    return [...host.querySelectorAll(".toast-notification-action")].map(
      (entry) => entry.textContent ?? "",
    );
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
  }

  async function click(target: HTMLButtonElement | null | undefined): Promise<void> {
    expect(target).not.toBeNull();
    expect(target).not.toBeUndefined();

    await act(async () => {
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  async function renderToast(): Promise<void> {
    const [groupKey, renderer] = agentProviderUpdateToastRenderer({ callbacks, view: VIEW })!;
    const notice = createWorkbenchNotice("info", "Agent provider", "ignored", groupKey);

    await act(async () => {
      root.render(<>{renderer(notice, { dismiss })}</>);
    });
  }
});
