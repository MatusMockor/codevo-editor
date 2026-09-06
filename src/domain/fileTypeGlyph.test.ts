import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FILE_TYPE_GLYPH_KINDS,
  FILE_TYPE_GLYPH_MAX_NAME_LENGTH,
  fileTypeGlyphKind,
  type FileTypeGlyphKind,
} from "./fileTypeGlyph";

const TOKENS_CSS_PATH = fileURLToPath(
  new URL("../components/agentMode/agentModeTokens.css", import.meta.url),
);

const EXTENSION_CASES: readonly (readonly [string, FileTypeGlyphKind])[] = [
  ["index.ts", "ts"],
  ["server.mts", "ts"],
  ["legacy.cts", "ts"],
  ["App.tsx", "tsx"],
  ["main.js", "js"],
  ["config.mjs", "js"],
  ["build.cjs", "js"],
  ["Widget.jsx", "js"],
  ["tsconfig.json", "json"],
  ["tsconfig.jsonc", "json"],
  ["data.json5", "json"],
  ["README.md", "md"],
  ["guide.mdx", "md"],
  ["app.css", "css"],
  ["theme.scss", "css"],
  ["legacy.less", "css"],
  ["run.sh", "sh"],
  ["setup.bash", "sh"],
  ["profile.zsh", "sh"],
];

const EXACT_NAME_CASES: readonly (readonly [string, FileTypeGlyphKind])[] = [
  ["package.json", "npm"],
  ["package-lock.json", "lock"],
  ["yarn.lock", "lock"],
  ["pnpm-lock.yaml", "lock"],
  ["bun.lockb", "lock"],
  ["Dockerfile", "docker"],
  ["docker-compose.yml", "docker"],
  ["docker-compose.prod.yml", "docker"],
  ["docker-compose.override.yaml", "docker"],
  [".dockerignore", "docker"],
  [".gitignore", "git"],
  [".gitattributes", "git"],
  [".gitmodules", "git"],
  [".env", "env"],
  [".env.local", "env"],
  [".env.production", "env"],
];

const FALLBACK_CASES: readonly string[] = [
  "",
  "notes",
  "archive.tar.gz",
  "image.png",
  "test.rest",
  "Makefile",
  ".babelrc",
  "docker-compose.txt",
];

describe("fileTypeGlyphKind", () => {
  it.each(EXTENSION_CASES)("maps %s to the %s glyph by extension", (name, expected) => {
    expect(fileTypeGlyphKind(name)).toBe(expected);
  });

  it.each(EXACT_NAME_CASES)("maps %s to the %s glyph by exact name", (name, expected) => {
    expect(fileTypeGlyphKind(name)).toBe(expected);
  });

  it.each(FALLBACK_CASES)("falls back to the generic glyph for %s", (name) => {
    expect(fileTypeGlyphKind(name)).toBe("file");
  });

  it("prefers exact names over the extension mapping", () => {
    expect(fileTypeGlyphKind("package.json")).not.toBe("json");
    expect(fileTypeGlyphKind("package-lock.json")).not.toBe("json");
    expect(fileTypeGlyphKind("pnpm-lock.yaml")).toBe("lock");
    expect(fileTypeGlyphKind("docker-compose.yml")).toBe("docker");
    expect(fileTypeGlyphKind("some-package.json")).toBe("json");
  });

  it("is case insensitive", () => {
    expect(fileTypeGlyphKind("PACKAGE.JSON")).toBe("npm");
    expect(fileTypeGlyphKind("dockerfile")).toBe("docker");
    expect(fileTypeGlyphKind("Index.TS")).toBe("ts");
    expect(fileTypeGlyphKind(".GitIgnore")).toBe("git");
  });

  it("classifies by basename only", () => {
    expect(fileTypeGlyphKind("/workspace/src/index.ts")).toBe("ts");
    expect(fileTypeGlyphKind("C:\\workspace\\package.json")).toBe("npm");
    expect(fileTypeGlyphKind("/ts/json/notes")).toBe("file");
  });

  it("rejects names beyond the bounded length", () => {
    const longestAccepted = `${"a".repeat(FILE_TYPE_GLYPH_MAX_NAME_LENGTH - 3)}.ts`;
    expect(longestAccepted).toHaveLength(FILE_TYPE_GLYPH_MAX_NAME_LENGTH);
    expect(fileTypeGlyphKind(longestAccepted)).toBe("ts");
    expect(fileTypeGlyphKind(`a${longestAccepted}`)).toBe("file");
  });

  it("returns only declared kinds", () => {
    const produced = new Set<FileTypeGlyphKind>([
      ...EXTENSION_CASES.map(([name]) => fileTypeGlyphKind(name)),
      ...EXACT_NAME_CASES.map(([name]) => fileTypeGlyphKind(name)),
      ...FALLBACK_CASES.map((name) => fileTypeGlyphKind(name)),
    ]);
    expect([...produced].every((kind) => FILE_TYPE_GLYPH_KINDS.includes(kind))).toBe(true);
    expect(produced.size).toBe(FILE_TYPE_GLYPH_KINDS.length);
  });
});

describe("file glyph colour tokens", () => {
  const css = readFileSync(TOKENS_CSS_PATH, "utf8");
  const colouredKinds = FILE_TYPE_GLYPH_KINDS.filter((kind) => kind !== "file");
  const darkBlock = blockFor(css, ".app-shell {");
  const lightBlock = blockFor(css, '.app-shell[data-theme="light"],');

  it.each(colouredKinds)("declares --codevo-ft-%s in the dark ladder", (kind) => {
    expect(darkBlock).toContain(`--codevo-ft-${kind}:`);
  });

  it.each(colouredKinds)("declares --codevo-ft-%s in the light ladder", (kind) => {
    expect(lightBlock).toContain(`--codevo-ft-${kind}:`);
  });

  it("keeps the generic glyph on the subtle foreground token", () => {
    expect(darkBlock).toContain("--codevo-fg-subtle:");
    expect(lightBlock).not.toContain("--codevo-ft-file:");
  });
});

function blockFor(css: string, selector: string): string {
  const selectorStart = css.indexOf(selector);
  expect(selectorStart, `selector ${selector} not found`).toBeGreaterThanOrEqual(0);
  const blockStart = css.indexOf("{", selectorStart);
  const blockEnd = css.indexOf("}", blockStart);
  expect(blockEnd).toBeGreaterThan(blockStart);

  return css.slice(blockStart, blockEnd);
}
