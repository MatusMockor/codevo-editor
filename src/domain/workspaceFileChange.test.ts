import { describe, expect, it } from "vitest";
import { canRefreshDocumentFromExternalFileChange } from "./workspaceFileChange";
import type { EditorDocument } from "./workspace";

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "<?php\n",
    language: "php",
    name: "User.php",
    path: "/workspace/app/Models/User.php",
    savedContent: "<?php\n",
    ...overrides,
  };
}

describe("workspace file changes", () => {
  it("allows external refreshes only for clean open documents", () => {
    expect(canRefreshDocumentFromExternalFileChange(document())).toBe(true);
    expect(
      canRefreshDocumentFromExternalFileChange(
        document({ content: "<?php\n// unsaved\n" }),
      ),
    ).toBe(false);
    expect(canRefreshDocumentFromExternalFileChange(null)).toBe(false);
  });
});
