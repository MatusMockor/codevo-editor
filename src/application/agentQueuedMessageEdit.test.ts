import { describe, expect, it } from "vitest";
import { RESTORED_PROMPT_SEPARATOR, mergeRestoredPrompt } from "./agentQueuedMessageEdit";

describe("mergeRestoredPrompt", () => {
  it("uses the restored text when the composer is empty", () => {
    expect(mergeRestoredPrompt("", "and then ship it")).toBe("and then ship it");
  });

  it("uses the restored text when the composer only holds whitespace", () => {
    expect(mergeRestoredPrompt("  \n\t ", "and then ship it")).toBe("and then ship it");
  });

  it("keeps the unsent text when there is nothing to restore", () => {
    expect(mergeRestoredPrompt("half a thought", "")).toBe("half a thought");
  });

  it("appends the restored text after a blank line", () => {
    expect(mergeRestoredPrompt("half a thought", "and then ship it")).toBe(
      "half a thought\n\nand then ship it",
    );
  });

  it("collapses existing trailing newlines into exactly one blank line", () => {
    expect(mergeRestoredPrompt("half a thought\n\n\n", "and then ship it")).toBe(
      "half a thought\n\nand then ship it",
    );
  });

  it("collapses trailing spaces and tabs into exactly one blank line", () => {
    expect(mergeRestoredPrompt("half a thought   \t", "and then ship it")).toBe(
      "half a thought\n\nand then ship it",
    );
  });

  it("keeps interior blank lines of both sides intact", () => {
    expect(mergeRestoredPrompt("one\n\ntwo", "three\n\nfour")).toBe("one\n\ntwo\n\nthree\n\nfour");
  });

  it("keeps leading whitespace of the restored text", () => {
    expect(mergeRestoredPrompt("intro", "  indented")).toBe("intro\n\n  indented");
  });

  it("returns an empty prompt when both sides are empty", () => {
    expect(mergeRestoredPrompt("", "")).toBe("");
  });

  it("drops a whitespace-only composer when there is nothing to restore", () => {
    expect(mergeRestoredPrompt("   ", "")).toBe("   ");
  });

  it("separates the two sides with a single blank line", () => {
    expect(RESTORED_PROMPT_SEPARATOR).toBe("\n\n");
    expect(mergeRestoredPrompt("a", "b").split(RESTORED_PROMPT_SEPARATOR)).toEqual(["a", "b"]);
  });
});
