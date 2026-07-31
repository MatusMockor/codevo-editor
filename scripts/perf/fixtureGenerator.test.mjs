import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  createSeededRandom,
  generateHugeUnionTsFileContent,
  generateLargeTsFileContent,
  generateMinifiedTsFileContent,
  writeLargeFileFixtures,
} from "./fixtureGenerator.mjs";

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

describe("createSeededRandom", () => {
  it("is deterministic for the same seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("generateLargeTsFileContent", () => {
  it("produces the requested line count deterministically", () => {
    const first = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    const second = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    expect(first).toBe(second);
    expect(first.split("\n").length).toBe(5000);
  });

  it.each([1, 2])("produces exactly %i line(s)", (lines) => {
    const content = generateLargeTsFileContent({ lines, random: createSeededRandom(1) });
    expect(content.split("\n").length).toBe(lines);
  });

  it("contains realistic TS constructs", () => {
    const content = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    expect(content).toContain("export interface ");
    expect(content).toContain("export function ");
    expect(content).toContain("export type ");
    expect(content).toContain("import ");
  });

  it.each([
    { lines: 5000, seed: 5 },
    { lines: 20000, seed: 20 },
    { lines: 100000, seed: 100 },
  ])("keeps the $lines-line fixture syntactically complete", ({ lines, seed }) => {
    const content = generateLargeTsFileContent({ lines, random: createSeededRandom(seed) });
    const openingBraces = content.match(/{/g)?.length ?? 0;
    const closingBraces = content.match(/}/g)?.length ?? 0;
    const lastNonEmptyLine = content.split("\n").findLast((line) => line.length > 0);

    expect(openingBraces).toBe(closingBraces);
    expect(lastNonEmptyLine?.endsWith("{")).toBe(false);
  });
});

describe("generateMinifiedTsFileContent", () => {
  it("emits a single line", () => {
    const content = generateMinifiedTsFileContent({
      statements: 20000,
      random: createSeededRandom(7),
    });
    expect(content.includes("\n")).toBe(false);
    expect(content.length).toBeGreaterThan(100000);
  });
});

describe("generateHugeUnionTsFileContent", () => {
  it("emits the requested union member count", () => {
    const content = generateHugeUnionTsFileContent({ members: 2000 });
    expect(content.split("|").length).toBeGreaterThanOrEqual(2000);
  });
});

describe("writeLargeFileFixtures", () => {
  it("emits project markers so the directory can be opened as a workspace", () => {
    const { volume, fs } = memFs();
    writeLargeFileFixtures({ rootDir: "/fx", fs });

    const pkg = JSON.parse(volume.readFileSync("/fx/large-files/package.json", "utf8"));
    expect(pkg).toEqual({ name: "@perf/large-files", private: true });

    const tsconfig = JSON.parse(volume.readFileSync("/fx/large-files/tsconfig.json", "utf8"));
    expect(tsconfig).toEqual({ compilerOptions: { strict: true }, include: ["*.ts"] });
  });

  it("still writes all five large-file fixtures alongside the markers", () => {
    const { volume, fs } = memFs();
    writeLargeFileFixtures({ rootDir: "/fx", fs });

    for (const name of ["large-5k.ts", "large-20k.ts", "large-100k.ts", "minified.ts", "huge-union.ts"]) {
      expect(volume.readFileSync(`/fx/large-files/${name}`, "utf8").length).toBeGreaterThan(0);
    }
  });
});
