import { describe, expect, it } from "vitest";
import type { NpmPackageDescriptor } from "./workspace";
import {
  buildPackageDependencyTree,
  locatePackageDependencyKey,
  packageDependencyCount,
} from "./packageDependencyTree";

describe("packageDependencyTree", () => {
  it("groups, sorts, filters, and exposes install state without mutating descriptors", () => {
    const packages: NpmPackageDescriptor[] = [
      dependency("vitest", true, { declaredRange: "^3", installPath: null }),
      dependency("express", false, { installedVersion: "5.1.0" }),
      dependency("@types/node", true, { installedVersion: "24.0.0" }),
    ];

    const tree = buildPackageDependencyTree(packages);
    expect(tree.map(({ id, items }) => [id, items.map((item) => item.name)])).toEqual([
      ["production", ["express"]],
      ["development", ["@types/node", "vitest"]],
    ]);
    expect(tree[0]?.items[0]).toMatchObject({
      declaredRange: "^1.0.0",
      installedVersion: "5.1.0",
      status: "installed",
    });
    expect(tree[1]?.items[1]).toMatchObject({ status: "missing" });
    expect(packageDependencyCount(tree)).toBe(3);
    expect(buildPackageDependencyTree(packages, "development missing ^3")).toMatchObject([
      { id: "development", items: [{ name: "vitest" }] },
    ]);
    expect(packages[0]?.name).toBe("vitest");
  });

  it("locates the exact JSON key in the matching production or development section", () => {
    const source = [
      "{",
      '  "name": "express is not a key",',
      '  "dependencies": {',
      '    "express": "^5"',
      "  },",
      '  "devDependencies": {',
      '    "express": "workspace:*",',
      '    "vite": "^7"',
      "  }",
      "}",
    ].join("\n");

    expect(locatePackageDependencyKey(source, { group: "production", name: "express" })).toEqual({
      column: 5,
      lineNumber: 4,
    });
    expect(locatePackageDependencyKey(source, { group: "development", name: "express" })).toEqual({
      column: 5,
      lineNumber: 7,
    });
    expect(
      locatePackageDependencyKey(source, { group: "development", name: "missing" }),
    ).toBeNull();
  });

  it("supports escaped dependency names and optional/peer production sections", () => {
    const source = '{\n  "peerDependencies": { "pkg\\u002dname": "*" }\n}';
    expect(locatePackageDependencyKey(source, { group: "production", name: "pkg-name" })).toEqual({
      column: 25,
      lineNumber: 2,
    });
  });

  it("ignores JSON punctuation inside strings and follows duplicate-key JSON semantics", () => {
    const source = [
      "{",
      '  "description": "braces { } and escaped quote \\"dependencies\\": are text",',
      '  "dependencies": { "express": "first", "express": "second" },',
      '  "dependencies": {',
      '    "note": "a } brace and \\"express\\" are text",',
      '    "express": "last"',
      "  }",
      "}",
    ].join("\n");

    expect(locatePackageDependencyKey(source, { group: "production", name: "express" })).toEqual({
      column: 5,
      lineNumber: 6,
    });
  });

  it("uses descriptor section priority and ignores non-object duplicate sections", () => {
    const prioritySource = [
      "{",
      '  "optionalDependencies": { "shared": "optional" },',
      '  "peerDependencies": { "shared": "peer" },',
      '  "dependencies": { "shared": "runtime" }',
      "}",
    ].join("\n");
    expect(locatePackageDependencyKey(prioritySource, { group: "production", name: "shared" })).toEqual(
      { column: 21, lineNumber: 4 },
    );

    const overwrittenSource =
      '{\n  "devDependencies": { "vitest": "^4" },\n  "devDependencies": null\n}';
    expect(
      locatePackageDependencyKey(overwrittenSource, { group: "development", name: "vitest" }),
    ).toBeNull();
  });
});

function dependency(
  name: string,
  dev: boolean,
  overrides: Partial<NpmPackageDescriptor> = {},
): NpmPackageDescriptor {
  return {
    declaredRange: "^1.0.0",
    dev,
    installedVersion: null,
    installPath: `/workspace/node_modules/${name}`,
    name,
    ...overrides,
  };
}
