import { describe, expect, it } from "vitest";
import { nextAgentPastedTextName, shouldAttachAgentTextPaste } from "./agentTextPaste";

describe("agent pasted text policy", () => {
  it("uses UTF-8 bytes and includes the exact threshold", () => {
    expect(shouldAttachAgentTextPaste("a".repeat(32767), "", 0, 0, 0)).toBe(false);
    expect(shouldAttachAgentTextPaste("a".repeat(32768), "", 0, 0, 0)).toBe(true);
    expect(shouldAttachAgentTextPaste("😀".repeat(9500), "", 0, 0, 0)).toBe(true);
    expect(shouldAttachAgentTextPaste("", "large", 0, 0, 40000)).toBe(false);
  });
  it("counts attachment references and replacement selection in the resulting prompt", () => {
    expect(shouldAttachAgentTextPaste("ab", "x", 1, 1, 32767)).toBe(true);
    expect(shouldAttachAgentTextPaste("a", "x", 1, 1, 32767)).toBe(false);
    expect(shouldAttachAgentTextPaste("ab", "😀", 0, 2, 32768)).toBe(false);
    expect(shouldAttachAgentTextPaste("ab", "😀", 2, 2, 32768)).toBe(true);
  });
  it("clamps selection and generates case-insensitive collision-free names", () => {
    expect(shouldAttachAgentTextPaste("a", "x", -10, 90000, 32768)).toBe(false);
    expect(nextAgentPastedTextName([])).toBe("pasted-text.txt");
    expect(nextAgentPastedTextName(["PASTED-TEXT.TXT", "pasted-text-2.txt", "other.txt"])).toBe(
      "pasted-text-3.txt",
    );
  });
});
