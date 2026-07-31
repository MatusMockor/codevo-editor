import { describe, expect, it } from "vitest";
import path from "node:path";
import { Volume } from "memfs";
import { writeMonorepoFixture, MONOREPO_PACKAGE_COUNT } from "./monorepoFixture.mjs";

function memFs() {
  const volume = new Volume();
  return {
    volume,
    fs: {
      mkdirSync: (p, o) => volume.mkdirSync(p, o),
      writeFileSync: (p, c) => volume.writeFileSync(p, c),
    },
  };
}

describe("writeMonorepoFixture", () => {
  it("creates the workspace root and all packages", () => {
    const { volume, fs } = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs });
    const rootPkg = JSON.parse(volume.readFileSync("/fx/monorepo/package.json", "utf8"));
    expect(rootPkg.workspaces).toEqual(["packages/*"]);
    expect(MONOREPO_PACKAGE_COUNT).toBe(50);
    const pkg = JSON.parse(volume.readFileSync("/fx/monorepo/packages/pkg-49/package.json", "utf8"));
    expect(pkg.name).toBe("@perf/pkg-49");
  });

  it("wires project references and cross-package imports", () => {
    const { volume, fs } = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs });
    const tsconfig = JSON.parse(volume.readFileSync("/fx/monorepo/packages/pkg-10/tsconfig.json", "utf8"));
    expect(tsconfig.references.length).toBeGreaterThan(0);
    const moduleA = volume.readFileSync("/fx/monorepo/packages/pkg-10/src/moduleA.ts", "utf8");
    expect(moduleA).toContain("@perf/pkg-");
    const barrel = volume.readFileSync("/fx/monorepo/packages/pkg-10/src/index.ts", "utf8");
    expect(barrel).toContain("export * from \"./moduleA\";");
    expect(barrel).toContain("export * as moduleB from \"./moduleB\";");
  });

  it("is deterministic", () => {
    const a = memFs();
    const b = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs: a.fs });
    writeMonorepoFixture({ rootDir: "/fx", fs: b.fs });
    expect(a.volume.readFileSync("/fx/monorepo/packages/pkg-05/src/moduleB.ts", "utf8")).toBe(
      b.volume.readFileSync("/fx/monorepo/packages/pkg-05/src/moduleB.ts", "utf8"),
    );
  });
});
