import { afterEach, describe, expect, it, vi } from "vitest";
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
    const prompter = new BrowserWorkbenchPrompter();

    expect(prompter.confirm("Discard changes?")).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Discard changes?");
  });

  it("treats blocked prompt dialogs as cancelled instead of throwing", () => {
    const prompt = vi.fn(() => {
      throw new Error("dialog.prompt not allowed. Command not found");
    });
    vi.stubGlobal("window", { prompt });
    const prompter = new BrowserWorkbenchPrompter();

    expect(prompter.prompt("Name", "default")).toBeNull();
    expect(prompt).toHaveBeenCalledWith("Name", "default");
  });
});
