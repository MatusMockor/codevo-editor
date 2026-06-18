import { describe, expect, it } from "vitest";
import { callHierarchyRows, callHierarchySectionTitle } from "./callHierarchy";
import type { LanguageServerRange } from "./languageServerFeatures";

describe("call hierarchy helpers", () => {
  it("flattens incoming and outgoing calls into navigable rows", () => {
    const rows = callHierarchyRows({
      incoming: [
        {
          from: item("render", "file:///workspace/src/app.ts", "src/app.ts"),
          fromRanges: [range(5, 2, 5, 10)],
        },
      ],
      item: item(
        "loadUser",
        "file:///workspace/src/userService.ts",
        "src/userService.ts",
      ),
      outgoing: [
        {
          fromRanges: [range(2, 2, 2, 12)],
          to: item("fetchUser", "file:///workspace/src/api.ts", "src/api.ts"),
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      detail: "src/app.ts:6",
      direction: "incoming",
      kindLabel: "function",
      label: "render",
      range: range(5, 2, 5, 10),
    });
    expect(rows[1]).toMatchObject({
      detail: "src/api.ts:2",
      direction: "outgoing",
      kindLabel: "method",
      label: "fetchUser",
      range: range(1, 9, 1, 17),
    });
    expect(callHierarchySectionTitle("incoming")).toBe("Incoming calls");
    expect(callHierarchySectionTitle("outgoing")).toBe("Outgoing calls");
  });
});

function item(name: string, uri: string, detail: string) {
  return {
    data: { symbolId: name },
    detail,
    kind: name === "render" ? 12 : 6,
    name,
    range: range(1, 0, 3, 1),
    selectionRange: range(1, 9, 1, 17),
    tags: [],
    uri,
  };
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): LanguageServerRange {
  return {
    end: { character: endCharacter, line: endLine },
    start: { character: startCharacter, line: startLine },
  };
}
