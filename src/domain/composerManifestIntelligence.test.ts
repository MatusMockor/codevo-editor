import { describe, expect, it } from "vitest";
import {
  composerManifestContextAt,
  composerPackageHoverMarkdown,
} from "./composerManifestIntelligence";
import type { ComposerPackageDescriptor } from "./workspace";

describe("composer manifest intelligence", () => {
  it.each([
    [
      "require key",
      '{"require":{"vendor/pack|age":"^1.0"}}',
      { keyPosition: true, packageName: "vendor/package", section: "require" },
    ],
    [
      "require-dev key",
      '{"require-dev":{"phpunit/php|unit":"^11"}}',
      {
        keyPosition: true,
        packageName: "phpunit/phpunit",
        section: "require-dev",
      },
    ],
    [
      "require value",
      '{"require":{"vendor/package":"^|1.0"}}',
      { keyPosition: false, section: "require" },
    ],
    [
      "nested braces in a value string",
      '{"require":{"vendor/package":"value { |nested }"}}',
      { keyPosition: false, section: "require" },
    ],
  ])("finds %s", (_name, markedSource, expected) => {
    const { offset, source } = sourceAtMarker(markedSource);

    expect(composerManifestContextAt(source, offset)).toEqual(expected);
  });

  it.each([
    ['{"name":"vendor/pack|age"}', "outside dependency sections"],
    ['{"require":{"vendor/package":"^1"', "malformed JSON"],
  ])("returns null for %s", (markedSource) => {
    const { offset, source } = sourceAtMarker(markedSource);

    expect(composerManifestContextAt(source, offset)).toBeNull();
  });

  it("formats installed production package hover markdown", () => {
    expect(
      composerPackageHoverMarkdown(
        "symfony/console",
        composerPackage({
          installPath: "/workspace/vendor/symfony/console",
          version: "v7.3.1",
        }),
      ),
    ).toBe(
      "**symfony/console**\n\nInstalled version: `v7.3.1`\n\nDevelopment dependency: No\n\nInstall path: `/workspace/vendor/symfony/console`",
    );
  });

  it("formats installed development package hover markdown", () => {
    expect(
      composerPackageHoverMarkdown(
        "phpunit/phpunit",
        composerPackage({ dev: true, installPath: null, version: "11.5.0" }),
      ),
    ).toBe(
      "**phpunit/phpunit**\n\nInstalled version: `11.5.0`\n\nDevelopment dependency: Yes\n\nInstall path: Not reported",
    );
  });

  it("formats not-installed package hover markdown", () => {
    expect(composerPackageHoverMarkdown("vendor/missing", null)).toBe(
      "**vendor/missing**\n\nNot installed in the active workspace.",
    );
  });
});

function sourceAtMarker(markedSource: string) {
  const offset = markedSource.indexOf("|");

  return {
    offset,
    source: markedSource.slice(0, offset) + markedSource.slice(offset + 1),
  };
}

function composerPackage(
  overrides: Partial<ComposerPackageDescriptor> = {},
): ComposerPackageDescriptor {
  return {
    classmapRoots: [],
    dev: false,
    installPath: "/workspace/vendor/vendor/package",
    name: "vendor/package",
    packageType: "library",
    psr4Roots: [],
    version: "1.0.0",
    ...overrides,
  };
}
