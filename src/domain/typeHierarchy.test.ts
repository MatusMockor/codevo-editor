import { describe, expect, it } from "vitest";
import {
  typeHierarchyRows,
  typeHierarchySectionTitle,
  type TypeHierarchyView,
} from "./typeHierarchy";

describe("type hierarchy helpers", () => {
  it("groups supertypes before subtypes and keeps navigation ranges", () => {
    const view: TypeHierarchyView = {
      item: item("User"),
      subtypes: [item("AdminUser", 12)],
      supertypes: [item("BaseUser", 4)],
    };

    expect(typeHierarchyRows(view)).toEqual([
      expect.objectContaining({
        direction: "supertype",
        detail: "src/BaseUser.ts:4",
        kindLabel: "class",
        label: "BaseUser",
        range: item("BaseUser", 4).selectionRange,
      }),
      expect.objectContaining({
        direction: "subtype",
        detail: "src/AdminUser.ts:12",
        label: "AdminUser",
      }),
    ]);
  });

  it("labels hierarchy sections", () => {
    expect(typeHierarchySectionTitle("supertype")).toBe("Supertypes");
    expect(typeHierarchySectionTitle("subtype")).toBe("Subtypes");
  });
});

function item(name: string, line = 2) {
  return {
    data: { id: name },
    detail: `src/${name}.ts`,
    kind: 5,
    name,
    range: {
      end: { character: 20, line: line - 1 },
      start: { character: 0, line: line - 1 },
    },
    selectionRange: {
      end: { character: name.length, line: line - 1 },
      start: { character: 0, line: line - 1 },
    },
    tags: [1],
    uri: `file:///project/src/${name}.ts`,
  };
}
