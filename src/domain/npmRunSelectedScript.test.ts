import { describe, expect, it } from "vitest";
import type { NodePackageScript } from "./nodePackageScripts";
import { npmRunSelectedScriptAt } from "./npmOpenScriptLocation";
import {
  exactDiscoveredNodePackageScript,
  npmRunSelectedScriptCommandId,
  npmRunSelectedScriptTitle,
} from "./npmRunSelectedScript";

const SOURCE = `{
  // local scripts
  "scripts": {
    "build": "vite --mode production",
    "test": "vitest"
  }
}`;

describe("npm run selected script domain", () => {
  it("pins the official id and resolves key-start through string-value-end inclusively", () => {
    const keyStart = SOURCE.indexOf('"build"');
    const valueEnd = SOURCE.indexOf('"vite --mode production"') + '"vite --mode production"'.length;
    for (const anchorOffset of [keyStart, keyStart + 3, keyStart + 8, valueEnd - 1, valueEnd]) {
      expect(
        npmRunSelectedScriptAt({
          anchorOffset,
          manifestContent: SOURCE,
          manifestRelativePath: "apps/web/package.json",
        }),
      ).toEqual({ manifestRelativePath: "apps/web/package.json", scriptName: "build" });
    }
    expect(npmRunSelectedScriptCommandId).toBe("npm.runSelectedScript");
    expect(npmRunSelectedScriptTitle).toBe("Run Script");
  });

  it("rejects anchors outside a string-valued script and non-local manifests", () => {
    const keyStart = SOURCE.indexOf('"build"');
    const valueEnd = SOURCE.indexOf('"vite --mode production"') + '"vite --mode production"'.length;
    for (const anchorOffset of [keyStart - 1, valueEnd + 1, SOURCE.indexOf('"scripts"')]) {
      expect(
        npmRunSelectedScriptAt({
          anchorOffset,
          manifestContent: SOURCE,
          manifestRelativePath: "package.json",
        }),
      ).toBeNull();
    }
    for (const manifestRelativePath of ["../package.json", "/package.json", "package-lock.json"]) {
      expect(
        npmRunSelectedScriptAt({
          anchorOffset: keyStart,
          manifestContent: SOURCE,
          manifestRelativePath,
        }),
      ).toBeNull();
    }
    expect(
      npmRunSelectedScriptAt({
        anchorOffset: 20,
        manifestContent: '{"scripts":{"build":true}}',
        manifestRelativePath: "package.json",
      }),
    ).toBeNull();
  });

  it("uses JavaScript UTF-16 offsets compatible with Monaco getOffsetAt", () => {
    const source = '{"name":"📦","scripts":{"build":"vite"}}';
    const anchorOffset = source.indexOf('"build"');
    expect(
      npmRunSelectedScriptAt({
        anchorOffset,
        manifestContent: source,
        manifestRelativePath: "package.json",
      }),
    ).toEqual({ manifestRelativePath: "package.json", scriptName: "build" });
  });

  it("returns only one canonical exact discovery identity", () => {
    const canonical = script("apps/web/package.json", "build");
    const selected = { manifestRelativePath: canonical.manifestRelativePath, scriptName: "build" };
    expect(
      exactDiscoveredNodePackageScript([script("package.json", "build"), canonical], selected),
    ).toBe(canonical);
    expect(exactDiscoveredNodePackageScript([canonical, { ...canonical }], selected)).toBeNull();
    expect(
      exactDiscoveredNodePackageScript([{ ...canonical, key: "forged" }], selected),
    ).toBeNull();
    expect(
      exactDiscoveredNodePackageScript(
        [{ ...canonical, packageRootRelativePath: "apps/api" }],
        selected,
      ),
    ).toBeNull();
  });
});

function script(manifestRelativePath: string, scriptName: string): NodePackageScript {
  return {
    key: `node-package-script:${encodeURIComponent(manifestRelativePath)}:${encodeURIComponent(scriptName)}`,
    manifestRelativePath,
    packageManager: "npm",
    packageName: null,
    packageRootRelativePath:
      manifestRelativePath === "package.json"
        ? ""
        : manifestRelativePath.slice(0, -"/package.json".length),
    scriptName,
  };
}
