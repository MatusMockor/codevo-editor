import { describe, expect, it, vi } from "vitest";
import { confirmWorkbenchAction } from "./workbenchPrompter";

describe("confirmWorkbenchAction", () => {
  it.each([
    ["sync false", () => false, false],
    ["sync true", () => true, true],
    ["async false", async () => false, false],
    ["async true", async () => true, true],
    ["malformed truthy", () => "yes" as unknown as boolean, false],
  ])("parses %s strictly", async (_label, confirm, expected) => {
    const prompter = { confirm: vi.fn(confirm) };

    await expect(confirmWorkbenchAction(prompter, "Continue?")).resolves.toBe(expected);
    expect(prompter.confirm).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "sync throw",
      () => {
        throw new Error("unavailable");
      },
    ],
    ["rejected promise", () => Promise.reject(new Error("unavailable"))],
  ])("fails closed for %s", async (_label, confirm) => {
    await expect(confirmWorkbenchAction({ confirm }, "Continue?")).resolves.toBe(false);
  });
});
