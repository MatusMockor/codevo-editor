import { describe, expect, it } from "vitest";
import {
  canExpandPhpFileEntry,
  emptyPhpFileOutline,
  flattenPhpFileOutlineNodes,
  isNavigablePhpFileOutlineNode,
  type PhpFileOutlineNode,
} from "./phpFileOutline";
import type { FileEntry } from "./workspace";

describe("phpFileOutline", () => {
  it("creates an empty outline", () => {
    expect(emptyPhpFileOutline()).toEqual({ nodes: [] });
  });

  it("allows only PHP files to expand into outlines", () => {
    expect(canExpandPhpFileEntry(file("User.php"))).toBe(true);
    expect(canExpandPhpFileEntry(file("User.PHP"))).toBe(true);
    expect(canExpandPhpFileEntry(file("User.ts"))).toBe(false);
    expect(
      canExpandPhpFileEntry({
        kind: "directory",
        name: "src.php",
        path: "/workspace/src.php",
      }),
    ).toBe(false);
  });

  it("flattens nested outline nodes with depth", () => {
    const root = outlineNode("class:user", "User", "class", [
      outlineNode("method:save", "save", "method", []),
    ]);
    const rows = flattenPhpFileOutlineNodes([root]);

    expect(rows.map((row) => [row.depth, row.node.label])).toEqual([
      [0, "User"],
      [1, "save"],
    ]);
    expect(isNavigablePhpFileOutlineNode(root)).toBe(true);
    expect(isNavigablePhpFileOutlineNode({ ...root, path: null })).toBe(false);
  });

  it("carries optional signature metadata on member nodes", () => {
    const method: PhpFileOutlineNode = {
      ...outlineNode("method:store", "store", "method", []),
      isStatic: true,
      parameters: [
        { name: "$request", type: "Request" },
        { name: "$id" },
      ],
      returnType: "?User",
      visibility: "protected",
    };

    expect(method.visibility).toBe("protected");
    expect(method.isStatic).toBe(true);
    expect(method.returnType).toBe("?User");
    expect(method.parameters).toEqual([
      { name: "$request", type: "Request" },
      { name: "$id" },
    ]);
  });

  it("treats signature metadata as optional for backward compatibility", () => {
    const legacy: PhpFileOutlineNode = outlineNode(
      "method:legacy",
      "legacy",
      "method",
      [],
    );

    expect(legacy.visibility).toBeUndefined();
    expect(legacy.parameters).toBeUndefined();
    expect(legacy.returnType).toBeUndefined();
    expect(legacy.isStatic).toBeUndefined();
  });
});

function file(name: string): FileEntry {
  return {
    kind: "file",
    name,
    path: `/workspace/${name}`,
  };
}

function outlineNode(
  id: string,
  label: string,
  kind: PhpFileOutlineNode["kind"],
  children: PhpFileOutlineNode[],
): PhpFileOutlineNode {
  return {
    children,
    column: 1,
    fullyQualifiedName: label,
    id,
    kind,
    label,
    lineNumber: 1,
    path: "/workspace/User.php",
    relativePath: "User.php",
  };
}
