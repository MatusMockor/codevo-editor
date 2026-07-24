import { describe, expect, it } from "vitest";
import type { PhpProjectDescriptor } from "./workspace";
import {
  isSymfonyPhpProject,
  phpSymfonyFrameworkProvider,
} from "./phpFrameworkSymfonyProvider";

describe("Symfony framework provider", () => {
  it.each(["symfony/framework-bundle", "symfony/symfony"])(
    "detects %s projects",
    (name) => expect(isSymfonyPhpProject(project(name))).toBe(true),
  );

  it("does not treat standalone Symfony components as an application", () => {
    expect(isSymfonyPhpProject(project("symfony/console"))).toBe(false);
  });

  it("owns stable presentation metadata", () => {
    expect(phpSymfonyFrameworkProvider).toMatchObject({
      id: "symfony",
      presentation: { activityLabel: "Symfony" },
    });
  });
});

function project(packageName: string): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "example/app",
    packages: [
      {
        classmapRoots: [],
        dev: false,
        installPath: null,
        name: packageName,
        packageType: null,
        psr4Roots: [],
        version: null,
      },
    ],
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
  };
}
