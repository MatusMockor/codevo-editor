import { describe, expect, it } from "vitest";
import {
  EDITOR_TAB_MIME,
  hasEditorTabDragType,
  readEditorTabDragPayload,
  writeEditorTabDragPayload,
} from "./editorTabDrag";

describe("editorTabDrag", () => {
  it("round trips the private versioned payload", () => {
    const transfer = dataTransfer();
    writeEditorTabDragPayload(transfer, {
      path: "/project/a.ts",
      projectId: "project-a",
      sourceGroupId: "left",
    });
    expect(transfer.values.has("text/plain")).toBe(false);
    expect(readEditorTabDragPayload(transfer, "project-a")).toEqual({
      path: "/project/a.ts",
      projectId: "project-a",
      sourceGroupId: "left",
      version: 1,
    });
    expect(hasEditorTabDragType(transfer)).toBe(true);
  });

  it.each([
    "",
    "not-json",
    "null",
    "[]",
    JSON.stringify({ version: 2, projectId: "project-a", sourceGroupId: "left", path: "/a" }),
    JSON.stringify({ version: 1, projectId: "project-a", sourceGroupId: "", path: "/a" }),
    JSON.stringify({ version: 1, projectId: "project-a", sourceGroupId: "left", path: "" }),
  ])("rejects malformed or foreign-version data: %s", (value) => {
    const transfer = dataTransfer();
    transfer.setData(EDITOR_TAB_MIME, value);
    expect(readEditorTabDragPayload(transfer, "project-a")).toBeNull();
  });

  it("rejects a payload from another project", () => {
    const transfer = dataTransfer();
    writeEditorTabDragPayload(transfer, { path: "/a", projectId: "other", sourceGroupId: "left" });
    expect(readEditorTabDragPayload(transfer, "current")).toBeNull();
  });
});

function dataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none" as DataTransfer["dropEffect"],
    effectAllowed: "none" as DataTransfer["effectAllowed"],
    values,
    get types() { return [...values.keys()]; },
    getData(type: string) { return values.get(type) ?? ""; },
    setData(type: string, value: string) { values.set(type, value); },
  };
}
