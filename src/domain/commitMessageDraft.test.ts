import { describe, expect, it } from "vitest";
import { generateCommitMessage, validateCommitMessage } from "./commitMessageDraft";

describe("generateCommitMessage", () => {
  it("uses the thread title as subject and infers a feat with a shared scope", () => {
    expect(
      generateCommitMessage({
        files: [
          { relativePath: "src/orders/idempotency.ts", status: "added" },
          { relativePath: "src/orders/routes.ts", status: "modified" },
        ],
        threadTitle: "Replay responses for repeated Idempotency-Key.",
      }),
    ).toBe("feat(orders): replay responses for repeated Idempotency-Key");
  });

  it("detects test-only and docs-only changes", () => {
    expect(
      generateCommitMessage({
        files: [{ relativePath: "test/orders.test.ts", status: "modified" }],
        threadTitle: "Cover retries",
      }),
    ).toBe("test(orders): cover retries");
    expect(
      generateCommitMessage({
        files: [{ relativePath: "README.md", status: "modified" }],
        threadTitle: null,
      }),
    ).toBe("docs: update README.md");
  });

  it("detects config-only changes as chores", () => {
    expect(
      generateCommitMessage({
        files: [
          { relativePath: "package.json", status: "modified" },
          { relativePath: "package-lock.json", status: "modified" },
        ],
        threadTitle: "Bump deps",
      }),
    ).toBe("chore: bump deps");
  });

  it("falls back to a file summary without a title", () => {
    expect(
      generateCommitMessage({
        files: [
          { relativePath: "src/a.ts", status: "modified" },
          { relativePath: "lib/b.ts", status: "modified" },
        ],
        threadTitle: "  ",
      }),
    ).toBe("fix: update 2 files");
  });

  it("keeps the subject within 72 characters on one line", () => {
    const message = generateCommitMessage({
      files: [{ relativePath: "src/a.ts", status: "modified" }],
      threadTitle: `Title\nwith newline ${"x".repeat(200)}`,
    });
    expect(message.includes("\n")).toBe(false);
    expect(message.length).toBeLessThanOrEqual(90);
  });
});

describe("validateCommitMessage", () => {
  it("trims a bounded message and rejects empty, NUL or oversized text", () => {
    expect(validateCommitMessage("  fix: x  ")).toEqual({ kind: "ok", message: "fix: x" });
    for (const bad of ["   ", "a\u0000b", "x".repeat(4_097)]) {
      expect(validateCommitMessage(bad).kind).toBe("invalid");
    }
  });
});
