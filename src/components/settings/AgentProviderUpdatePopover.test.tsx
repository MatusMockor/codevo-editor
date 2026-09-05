// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProviderUpdatePopover } from "./AgentProviderUpdatePopover";
import type { AgentProviderAvailableUpdate } from "./agentProviderUpdatePresentation";

describe("AgentProviderUpdatePopover", () => {
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

  it("offers the built-in updater for a native self-update installation", () => {
    const onUpdate = vi.fn();

    render({ installer: { kind: "selfUpdate", command: "claudeUpdate" } }, { onUpdate });

    expect(host.textContent).toContain("Update available: install v2.2.0.");
    expect(host.textContent).toContain("Installed v2.1.245.");
    expect(host.querySelector("code")?.textContent).toBe("claude update");

    act(() => byText("Update now").click());

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: "npm", packageName: "@openai/codex" } as const, "npm install -g @openai/codex@latest"],
    [{ kind: "homebrew", cask: "claude-code" } as const, "brew upgrade --cask claude-code"],
    [{ kind: "selfUpdate", command: "codexUpdate" } as const, "codex update"],
  ])("copies the manual command for the %o installer", (installer, command) => {
    const onCopyCommand = vi.fn();

    render({ installer }, { onCopyCommand });

    expect(host.textContent).toContain("or, update manually using");
    expect(host.querySelector("code")?.textContent).toBe(command);

    act(() => byLabel("Copy Codex update command").click());

    expect(onCopyCommand).toHaveBeenCalledWith(command);
  });

  it("skips the offered version", () => {
    const onDismiss = vi.fn();

    render({}, { onDismiss });

    act(() => byText("Skip this version").click());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("refuses the update with its exact reason", () => {
    const onUpdate = vi.fn();

    render({}, { blockedReason: "Stop running Codex turns first.", onUpdate });

    const update = byText("Update now");

    expect(update.disabled).toBe(true);
    expect(update.title).toBe("Stop running Codex turns first.");
    expect(host.textContent).toContain("Stop running Codex turns first.");

    act(() => update.click());

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("reports the running installation instead of a fresh offer", () => {
    render({}, { updating: true });

    const update = byText("Updating Codex");

    expect(update.disabled).toBe(true);
    expect(update.getAttribute("aria-busy")).toBe("true");
  });

  it("closes on Escape and restores focus to the anchor", () => {
    const onClose = vi.fn();

    render({}, { onClose });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledWith(true);
  });

  function render(
    update: Partial<AgentProviderAvailableUpdate> = {},
    overrides: Partial<Parameters<typeof AgentProviderUpdatePopover>[0]> = {},
  ): void {
    const anchor = document.createElement("button");

    host.append(anchor);

    const anchorRef = createRef<HTMLElement | null>();

    anchorRef.current = anchor;

    const available: AgentProviderAvailableUpdate = {
      kind: "available",
      installedVersion: "2.1.245",
      availableVersion: "2.2.0",
      installer: { kind: "npm", packageName: "@openai/codex" },
      ...update,
    };

    act(() =>
      root.render(
        <AgentProviderUpdatePopover
          anchorRef={anchorRef}
          available={available}
          blockedReason={null}
          onClose={() => undefined}
          onCopyCommand={() => undefined}
          onDismiss={() => undefined}
          onUpdate={() => undefined}
          open={true}
          providerLabel="Codex"
          updating={false}
          {...overrides}
        />,
      ),
    );
  }

  function byLabel(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

    expect(element).not.toBeNull();

    return element ?? document.createElement("button");
  }

  function byText(label: string): HTMLButtonElement {
    const element = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(element).toBeDefined();

    return element ?? document.createElement("button");
  }
});
