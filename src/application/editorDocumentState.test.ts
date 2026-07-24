import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { isCleanWritableDocument } from "./editorDocumentState";

const clean: EditorDocument = {
  content: "saved",
  language: "typescript",
  name: "example.ts",
  path: "/workspace/example.ts",
  readOnly: false,
  savedContent: "saved",
};

describe("isCleanWritableDocument", () => {
  it("accepts only a clean writable document", () => {
    expect(isCleanWritableDocument(clean)).toBe(true);
    expect(isCleanWritableDocument(null)).toBe(false);
    expect(isCleanWritableDocument({ ...clean, readOnly: true })).toBe(false);
    expect(isCleanWritableDocument({ ...clean, content: "dirty" })).toBe(false);
  });
});
