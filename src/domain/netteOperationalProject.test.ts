import { describe, expect, it } from "vitest";
import type { PhpProjectDescriptor } from "./workspace";
import { isNetteApplicationProject } from "./netteOperationalProject";

describe("isNetteApplicationProject", () => {
  it("requires the exact nette/application Composer package", () => {
    expect(isNetteApplicationProject(project(["nette/application"]))).toBe(true);
    expect(isNetteApplicationProject(project(["latte/latte"]))).toBe(false);
    expect(isNetteApplicationProject(project(["vendor/nette/application-tools"]))).toBe(false);
  });
});

function project(names: string[]): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "example/app",
    packages: names.map((name) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
  };
}
