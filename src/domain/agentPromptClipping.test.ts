import { describe, expect, it } from "vitest";
import {
  CLIPPED_AGENT_PROMPT_MARKER,
  CLIPPED_AGENT_PROMPT_PREFIX_BYTES,
  agentPromptLooksClipped,
  clipAgentPromptForPersistence,
  restoreAgentPromptFromLog,
  utf8ByteLength,
} from "./agentPromptClipping";

const MARKER_BYTES = utf8ByteLength(CLIPPED_AGENT_PROMPT_MARKER);
const CLIP_THRESHOLD_BYTES = CLIPPED_AGENT_PROMPT_PREFIX_BYTES + MARKER_BYTES;

function clipped(prompt: string): string {
  const value = clipAgentPromptForPersistence(prompt);
  expect(value).not.toBeNull();
  return value ?? "";
}

describe("agent prompt clipping", () => {
  it("keeps a prompt that cannot be made shorter", () => {
    expect(clipAgentPromptForPersistence("")).toBeNull();
    expect(clipAgentPromptForPersistence("short prompt")).toBeNull();
    expect(clipAgentPromptForPersistence("a".repeat(CLIP_THRESHOLD_BYTES))).toBeNull();
  });

  it("clips a prompt one byte above the threshold and still shortens it", () => {
    const prompt = "a".repeat(CLIP_THRESHOLD_BYTES + 1);
    const value = clipped(prompt);

    expect(utf8ByteLength(value)).toBeLessThan(utf8ByteLength(prompt));
    expect(utf8ByteLength(value)).toBe(CLIP_THRESHOLD_BYTES);
    expect(value.length).toBeGreaterThan(0);
    expect(agentPromptLooksClipped(value)).toBe(true);
  });

  it("never splits a code point and stays inside the prefix bound", () => {
    for (const glyph of ["🙂", "字", "é"]) {
      const prompt = glyph.repeat(4_000);
      const value = clipped(prompt);
      const body = value.slice(0, value.length - CLIPPED_AGENT_PROMPT_MARKER.length);

      expect(utf8ByteLength(body)).toBeLessThanOrEqual(CLIPPED_AGENT_PROMPT_PREFIX_BYTES);
      expect([...body].every((character) => character === glyph)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(prompt.startsWith(body)).toBe(true);
    }
  });

  it("is idempotent because a clipped prompt is already below the threshold", () => {
    const value = clipped("z".repeat(40_000));
    expect(clipAgentPromptForPersistence(value)).toBeNull();
    expect(value.split(CLIPPED_AGENT_PROMPT_MARKER)).toHaveLength(2);
  });

  it("restores a clipped prompt from the log", () => {
    const prompt = `ask ${"q".repeat(40_000)}`;
    expect(restoreAgentPromptFromLog(clipped(prompt), prompt)).toBe(prompt);
  });

  it("keeps a short prompt that legitimately ends with the marker text", () => {
    const prompt = `please explain ${CLIPPED_AGENT_PROMPT_MARKER}`;

    expect(agentPromptLooksClipped(prompt)).toBe(true);
    expect(restoreAgentPromptFromLog(prompt, prompt)).toBeNull();
  });

  it("restores a long clipped prompt whose real text also ends with the marker", () => {
    const prompt = `${"w".repeat(4_000)}${CLIPPED_AGENT_PROMPT_MARKER}`;
    expect(restoreAgentPromptFromLog(clipped(prompt), prompt)).toBe(prompt);
  });

  it("does not treat a prompt that only contains the marker as clipped", () => {
    const prompt = `before ${CLIPPED_AGENT_PROMPT_MARKER} after`;

    expect(agentPromptLooksClipped(prompt)).toBe(false);
    expect(restoreAgentPromptFromLog(prompt, `${prompt} and more text`)).toBeNull();
  });

  it("fails closed when the log prompt does not carry the clipped body", () => {
    const prompt = `mine ${"m".repeat(40_000)}`;
    const foreign = `theirs ${"t".repeat(40_000)}`;

    expect(restoreAgentPromptFromLog(clipped(prompt), foreign)).toBeNull();
    expect(restoreAgentPromptFromLog(clipped(prompt), "")).toBeNull();
  });

  it("fails closed when the log prompt is not longer than the stored prompt", () => {
    const value = clipped("n".repeat(40_000));
    const body = value.slice(0, value.length - CLIPPED_AGENT_PROMPT_MARKER.length);

    expect(restoreAgentPromptFromLog(value, body)).toBeNull();
    expect(restoreAgentPromptFromLog(value, value)).toBeNull();
  });

  it("refuses to restore an unclipped prompt", () => {
    expect(restoreAgentPromptFromLog("do the thing", "do the thing and more")).toBeNull();
  });
});
