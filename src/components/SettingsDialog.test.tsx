// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog", () => {
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

  it("autosaves setting changes without a Save button", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Save",
      ),
    ).toBe(false);

    await act(async () => {
      revealActiveFileCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        revealActiveFileInTree: false,
      },
    });
  });

  it("keeps Auto Save enabled by default and persists disabling it from settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(autoSaveCheckbox().checked).toBe(true);

    await act(async () => {
      autoSaveCheckbox().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        autoSaveConfigured: true,
      },
    });
  });

  function revealActiveFileCheckbox(): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("Reveal active file in tree"),
    );
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error("Reveal active file checkbox was not rendered.");
    }

    return input;
  }

  function autoSaveCheckbox(): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) => item.textContent?.includes("Auto Save"));
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error("Auto Save checkbox was not rendered.");
    }

    return input;
  }
});
