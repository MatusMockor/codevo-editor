import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickInputCoordinator } from "../application/quickInputCoordinator";
import { BrowserWorkbenchPrompter } from "./browserWorkbenchPrompter";

const { dialogConfirm } = vi.hoisted(() => ({ dialogConfirm: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: dialogConfirm }));

describe("BrowserWorkbenchPrompter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats rejected native confirm dialogs as declined instead of throwing", async () => {
    dialogConfirm.mockRejectedValueOnce(new Error("dialog.confirm not allowed. Command not found"));
    const prompter = new BrowserWorkbenchPrompter(new QuickInputCoordinator());

    await expect(prompter.confirm("Discard changes?")).resolves.toBe(false);
    expect(dialogConfirm).toHaveBeenCalledWith("Discard changes?");
  });

  it("routes text input through the app-owned quick-input coordinator", async () => {
    const quickInput = new QuickInputCoordinator();
    const prompter = new BrowserWorkbenchPrompter(quickInput);
    const pending = prompter.prompt("Name", "default");
    const request = quickInput.getSnapshot();

    expect(request).toEqual({ defaultValue: "default", message: "Name" });
    quickInput.resolveActive(request!, "chosen");
    await expect(pending).resolves.toBe("chosen");
  });
});
