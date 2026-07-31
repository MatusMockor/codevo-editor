import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  generateHugeUnionTsFileContent,
  generateLargeTsFileContent,
  generateMinifiedTsFileContent,
} from "./fixtureGenerator.mjs";

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
