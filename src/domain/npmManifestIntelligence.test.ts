import { describe, expect, it } from "vitest";
import {
  npmManifestContextAt,
  npmPackageHoverMarkdown,
} from "./npmManifestIntelligence";
import type { NpmPackageDescriptor } from "./workspace";

describe("npm manifest intelligence", () => {
  it.each([
    ["dependencies", '{"dependencies":{"rea|ct":"^19"}}'],
    ["devDependencies", '{"devDependencies":{"vite|st":"^4"}}'],
    ["peerDependencies", '{"peerDependencies":{"rea|ct":">=18"}}'],
    ["optionalDependencies", '{"optionalDependencies":{"fsev|ents":"^2"}}'],
  ] as const)("finds a package key in %s", (section, markedSource) => {
    const { offset, source } = sourceAtMarker(markedSource);

    expect(npmManifestContextAt(source, offset)).toEqual({
      keyPosition: true,
      packageName: expect.any(String),
      section,
    });
  });

  it("distinguishes dependency values from keys", () => {
    const { offset, source } = sourceAtMarker(
      '{"dependencies":{"react":"^|19"}}',
    );

    expect(npmManifestContextAt(source, offset)).toEqual({
      keyPosition: false,
      section: "dependencies",
    });
  });

  it.each([
    ['{"name":"rea|ct"}', "outside dependency sections"],
    ['{"dependencies":{"react":"^19"', "malformed JSON"],
  ])("returns null for %s", (markedSource) => {
    const { offset, source } = sourceAtMarker(markedSource);

    expect(npmManifestContextAt(source, offset)).toBeNull();
  });

  it("formats installed production package hover markdown", () => {
    expect(
      npmPackageHoverMarkdown("react", npmPackage()),
    ).toBe(
      "**react**\n\nDeclared range: `^19.0.0`\n\nInstalled version: `19.1.0`\n\nDevelopment dependency: No",
    );
  });

  it("formats installed development package hover markdown", () => {
    expect(
      npmPackageHoverMarkdown("vitest", npmPackage({ dev: true })),
    ).toContain("Development dependency: Yes");
  });

  it("formats not-installed package hover markdown", () => {
    expect(
      npmPackageHoverMarkdown(
        "react",
        npmPackage({ installPath: null, installedVersion: null }),
      ),
    ).toContain("Installed version: Not installed");
  });
});

function sourceAtMarker(markedSource: string) {
  const offset = markedSource.indexOf("|");

  return {
    offset,
    source: markedSource.slice(0, offset) + markedSource.slice(offset + 1),
  };
}

function npmPackage(
  overrides: Partial<NpmPackageDescriptor> = {},
): NpmPackageDescriptor {
  return {
    declaredRange: "^19.0.0",
    dev: false,
    installedVersion: "19.1.0",
    installPath: "/workspace/node_modules/react",
    name: "react",
    ...overrides,
  };
}
