import { describe, expect, it } from "vitest";
import {
  MAX_NPM_OPEN_SCRIPT_JSON_NODES,
  MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES,
  MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES,
  nodePackageScriptLocation,
  npmOpenScriptLocation,
} from "./npmOpenScriptLocation";

describe("npmOpenScriptLocation", () => {
  it("resolves the exact quoted script key token in a root manifest", () => {
    const source = `{
  "description": "build appears in a value",
  "scripts": {
    "build": "echo build"
  }
}`;
    const result = npmOpenScriptLocation({
      manifestContent: source,
      manifestRelativePath: "package.json",
      scriptName: "build",
    });
    const expectedStart = source.indexOf('"build":');

    expect(result).toEqual({
      end: { column: 12, lineNumber: 4 },
      endOffset: expectedStart + '"build"'.length,
      manifestRelativePath: "package.json",
      scriptName: "build",
      start: { column: 5, lineNumber: 4 },
      startOffset: expectedStart,
    });
    expect(source.slice(result?.startOffset, result?.endOffset)).toBe('"build"');
  });

  it("supports monorepo manifests and the validated package-node adapter", () => {
    const source = '{"scripts":{"dev":"vite"}}';
    expect(
      nodePackageScriptLocation(source, {
        manifestRelativePath: "apps/web/package.json",
        scriptName: "dev",
      }),
    ).toMatchObject({
      manifestRelativePath: "apps/web/package.json",
      scriptName: "dev",
    });
  });

  it("handles CRLF, JSONC comments, trailing commas, and escaped key spelling", () => {
    const source = [
      "{",
      "  // package commands",
      '  "scripts": {',
      '    "bu\\u0069ld": "vite build",',
      "  },",
      "}",
    ].join("\r\n");
    const result = npmOpenScriptLocation({
      manifestContent: source,
      manifestRelativePath: "packages/ui/package.json",
      scriptName: "build",
    });

    expect(result).toMatchObject({
      start: { column: 5, lineNumber: 4 },
      end: { column: 17, lineNumber: 4 },
    });
    expect(source.slice(result?.startOffset, result?.endOffset)).toBe('"bu\\u0069ld"');
  });

  it("tracks CR-only positions and terminates line comments at CR", () => {
    const source = [
      "{",
      "  // package commands",
      '  "scripts": {',
      '    "build": "vite build"',
      "  }",
      "}",
    ].join("\r");
    const result = location(source);

    expect(result).toMatchObject({
      start: { column: 5, lineNumber: 4 },
      end: { column: 12, lineNumber: 4 },
    });
    expect(source.slice(result?.startOffset, result?.endOffset)).toBe('"build"');
  });

  it("matches decoded escaped names including escaped quotes", () => {
    const source = String.raw`{"scripts":{"say\"hi":"node hi.js"}}`;
    const result = npmOpenScriptLocation({
      manifestContent: source,
      manifestRelativePath: "package.json",
      scriptName: 'say"hi',
    });
    expect(source.slice(result?.startOffset, result?.endOffset)).toBe(String.raw`"say\"hi"`);
  });

  it("fails closed for duplicate decoded keys at any relevant structure", () => {
    for (const source of [
      '{"scripts":{"build":"a","build":"b"}}',
      '{"scripts":{"build":"a","bu\\u0069ld":"b"}}',
      '{"scripts":{"build":"a"},"scripts":{"build":"b"}}',
      '{"name":"a","name":"b","scripts":{"build":"ok"}}',
    ]) {
      expect(location(source)).toBeNull();
    }
  });

  it("fails closed for malformed, incomplete, dynamic, or non-string script structures", () => {
    for (const source of [
      "",
      "[]",
      '{"scripts":',
      '{"scripts":null}',
      '{"scripts":[]}',
      '{"scripts":{"build":null}}',
      '{"scripts":{"build":["vite"]}}',
      '{"scripts":{"build":{"command":"vite"}}}',
      '{"scripts":{"other":"vite"}}',
      '{"nested":{"scripts":{"build":"vite"}}}',
      '{"scripts":{"build":"vite"}} trailing',
      '{\u00a0"scripts":{"build":"vite"}}',
      '{"scripts":{/* unterminated',
    ]) {
      expect(location(source)).toBeNull();
    }
  });

  it("validates normalized package.json paths and safe script names", () => {
    const source = '{"scripts":{"build":"vite"}}';
    for (const manifestRelativePath of [
      "/package.json",
      "../package.json",
      "apps\\web\\package.json",
      "apps/web/manifest.json",
      "apps//web/package.json",
    ]) {
      expect(
        npmOpenScriptLocation({ manifestContent: source, manifestRelativePath, scriptName: "build" }),
      ).toBeNull();
    }
    for (const scriptName of ["", "-build", "bad\nname", "\ud800"]) {
      expect(
        npmOpenScriptLocation({
          manifestContent: source,
          manifestRelativePath: "package.json",
          scriptName,
        }),
      ).toBeNull();
    }
  });

  it("enforces byte, line, node, depth, and Unicode budgets", () => {
    const base = '{"scripts":{"build":"vite"}}';
    const exactBytes = `${base}${" ".repeat(MAX_NPM_OPEN_SCRIPT_MANIFEST_BYTES - base.length)}`;
    expect(location(exactBytes)).not.toBeNull();
    expect(location(`${exactBytes} `)).toBeNull();

    const exactLines = `${base}${"\n".repeat(MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES - 1)}`;
    expect(location(exactLines)).not.toBeNull();
    expect(location(`${exactLines}\n`)).toBeNull();

    const exactCrLines = `${base}${"\r".repeat(MAX_NPM_OPEN_SCRIPT_MANIFEST_LINES - 1)}`;
    expect(location(exactCrLines)).not.toBeNull();
    expect(location(`${exactCrLines}\r`)).toBeNull();

    const excessiveNodes = `{"padding":[${Array.from(
      { length: MAX_NPM_OPEN_SCRIPT_JSON_NODES },
      () => "null",
    ).join(",")}],"scripts":{"build":"vite"}}`;
    expect(location(excessiveNodes)).toBeNull();

    const deep = `${"[".repeat(130)}null${"]".repeat(130)}`;
    expect(location(deep)).toBeNull();
    expect(location(`${base}\ud800`)).toBeNull();
    expect(location('{"scripts":{"\\ud800":"vite"}}')).toBeNull();
  });

  it("returns a deeply immutable location", () => {
    const result = location('{"scripts":{"build":"vite"}}');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.start)).toBe(true);
    expect(Object.isFrozen(result?.end)).toBe(true);
  });
});

function location(source: string) {
  return npmOpenScriptLocation({
    manifestContent: source,
    manifestRelativePath: "package.json",
    scriptName: "build",
  });
}
