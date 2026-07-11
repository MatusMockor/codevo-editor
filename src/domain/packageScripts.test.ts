import { describe, expect, it } from "vitest";
import {
  parseComposerScripts,
  parsePackageJsonScripts,
} from "./packageScripts";

describe("parseComposerScripts", () => {
  it("preserves manifest order and supports string and command-array values", () => {
    expect(
      parseComposerScripts(`{
        "scripts": {
          "test": "phpunit",
          "quality:all": ["phpstan", "php-cs-fixer"],
          "build.assets": "vite build"
        }
      }`),
    ).toEqual([
      { name: "test", command: "phpunit" },
      { name: "quality:all", command: ["phpstan", "php-cs-fixer"] },
      { name: "build.assets", command: "vite build" },
    ]);
  });

  it("returns no scripts for malformed JSON or a missing scripts field", () => {
    expect(parseComposerScripts("{")).toEqual([]);
    expect(parseComposerScripts('{"name":"acme/app"}')).toEqual([]);
  });

  it("skips unsupported values, invalid arrays, and unsafe names", () => {
    expect(
      parseComposerScripts(`{
        "scripts": {
          "valid-name_1": "phpunit",
          "also.valid": ["one", "two"],
          "object": {"cmd": "phpunit"},
          "mixed": ["one", 2],
          "empty-array": [],
          "evil; touch pwned": "phpunit",
          "evil$(whoami)": "phpunit",
          "with space": "phpunit",
          "--version": "phpunit",
          "-C": "phpunit",
          ".hidden": "phpunit"
        }
      }`),
    ).toEqual([
      { name: "valid-name_1", command: "phpunit" },
      { name: "also.valid", command: ["one", "two"] },
    ]);
  });
});

describe("parsePackageJsonScripts", () => {
  it("preserves manifest order and skips non-string values", () => {
    expect(
      parsePackageJsonScripts(`{
        "scripts": {
          "dev": "vite",
          "test:unit": "vitest run",
          "invalid-value": ["one", "two"],
          "build.prod": "vite build"
        }
      }`),
    ).toEqual([
      { name: "dev", command: "vite" },
      { name: "test:unit", command: "vitest run" },
      { name: "build.prod", command: "vite build" },
    ]);
  });

  it("returns no scripts for malformed JSON, missing scripts, or unsafe names", () => {
    expect(parsePackageJsonScripts("not json")).toEqual([]);
    expect(parsePackageJsonScripts('{"private":true}')).toEqual([]);
    expect(
      parsePackageJsonScripts(
        '{"scripts":{"ok":"vite","bad && whoami":"evil","@scope/pkg":"nope"}}',
      ),
    ).toEqual([{ name: "ok", command: "vite" }]);
  });
});
