import { describe, expect, it } from "vitest";
import { restoreUnchangedWorkspaceEditDocuments } from "./workspaceEditApplication";

describe("restoreUnchangedWorkspaceEditDocuments", () => {
  it("restores only touched documents that still contain the applied content", () => {
    const original = {
      "/workspace/a.php": { content: "original a", marker: "a" },
      "/workspace/b.php": { content: "original b", marker: "b" },
      "/workspace/untouched.php": {
        content: "original untouched",
        marker: "u",
      },
    };
    const applied = {
      ...original,
      "/workspace/a.php": { content: "applied a", marker: "a" },
      "/workspace/b.php": { content: "applied b", marker: "b" },
    };
    const current = {
      ...applied,
      "/workspace/b.php": { content: "user edit", marker: "b" },
      "/workspace/untouched.php": {
        content: "later untouched edit",
        marker: "u",
      },
    };

    const restored = restoreUnchangedWorkspaceEditDocuments(
      current,
      original,
      applied,
      ["/workspace/a.php", "/workspace/b.php"],
    );

    expect(restored["/workspace/a.php"]).toBe(original["/workspace/a.php"]);
    expect(restored["/workspace/b.php"]?.content).toBe("user edit");
    expect(restored["/workspace/untouched.php"]?.content).toBe(
      "later untouched edit",
    );
  });

  it("preserves object identity when no touched document is safe to restore", () => {
    const original = { "/workspace/a.php": { content: "original" } };
    const applied = { "/workspace/a.php": { content: "applied" } };
    const current = { "/workspace/a.php": { content: "user edit" } };

    expect(
      restoreUnchangedWorkspaceEditDocuments(current, original, applied, [
        "/workspace/a.php",
      ]),
    ).toBe(current);
  });

  it("preserves an ABA edit represented by a newer document object", () => {
    const original = { "/workspace/a.php": { content: "original" } };
    const applied = { "/workspace/a.php": { content: "applied" } };
    const current = { "/workspace/a.php": { content: "applied" } };

    expect(
      restoreUnchangedWorkspaceEditDocuments(current, original, applied, [
        "/workspace/a.php",
      ]),
    ).toBe(current);
  });
});
