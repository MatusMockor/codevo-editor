import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickInputCoordinator } from "../application/quickInputCoordinator";
import { BrowserWorkbenchPrompter } from "./browserWorkbenchPrompter";

describe("BrowserWorkbenchPrompter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats blocked confirm dialogs as declined instead of throwing", () => {
    const confirm = vi.fn(() => {
      throw new Error("dialog.confirm not allowed. Command not found");
    });
    vi.stubGlobal("window", { confirm });
    const prompter = new BrowserWorkbenchPrompter(new QuickInputCoordinator());

    expect(prompter.confirm("Discard changes?")).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Discard changes?");
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
