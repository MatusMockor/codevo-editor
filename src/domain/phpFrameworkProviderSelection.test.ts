import { describe, expect, it, vi } from "vitest";
import type { PhpProjectDescriptor } from "./workspace";
import type { PhpFrameworkProviderCore } from "./phpFrameworkProviderCore";
import {
  registerPhpFrameworkProviderProjectSpecializer,
  selectPhpFrameworkProvidersForProject,
  specializePhpFrameworkProviderForProject,
} from "./phpFrameworkProviderSelection";

interface TestProvider extends PhpFrameworkProviderCore {
  readonly projectScoped?: boolean;
}

const PHP_PROJECT: PhpProjectDescriptor = {
  classmapRoots: [],
  hasComposer: true,
  packageName: "acme/app",
  packages: [],
  phpPlatformVersion: null,
  phpVersionConstraint: null,
  psr4Roots: [],
};

describe("selectPhpFrameworkProvidersForProject", () => {
  it("returns an empty selection without a PHP project", () => {
    expect(selectPhpFrameworkProvidersForProject(null, [])).toEqual({
      activityLabel: null,
      matchedProviderIds: [],
      providers: [],
    });
  });

  it("uses registry order for the winner and reports every matched ID", () => {
    const first: TestProvider = {
      id: "first",
      appliesTo: () => true,
      presentation: { activityLabel: "First" },
    };
    const second: TestProvider = {
      id: "second",
      appliesTo: () => true,
      presentation: { activityLabel: "Second" },
    };

    expect(
      selectPhpFrameworkProvidersForProject(PHP_PROJECT, [first, second]),
    ).toEqual({
      activityLabel: "First",
      matchedProviderIds: ["first", "second"],
      providers: [first],
    });
  });

  it("calls appliesTo once per provider and specializes only the winner", () => {
    const projectProvider: TestProvider = {
      id: "first",
      presentation: { activityLabel: "Project First" },
      projectScoped: true,
    };
    const firstAppliesTo = vi.fn((_: PhpProjectDescriptor) => true);
    const firstForProject = vi.fn(
      (_: PhpProjectDescriptor): TestProvider => projectProvider,
    );
    const secondAppliesTo = vi.fn((_: PhpProjectDescriptor) => true);
    const secondForProject = vi.fn(
      (_: PhpProjectDescriptor): TestProvider => ({
        id: "second",
        projectScoped: true,
      }),
    );
    const first: TestProvider = {
      id: "first",
      appliesTo: firstAppliesTo,
    };
    const second: TestProvider = {
      id: "second",
      appliesTo: secondAppliesTo,
    };
    const selection = selectPhpFrameworkProvidersForProject(
      PHP_PROJECT,
      [first, second],
      (provider, php) =>
        provider.id === "first"
          ? firstForProject(php)
          : secondForProject(php),
    );

    expect(firstAppliesTo).toHaveBeenCalledOnce();
    expect(firstAppliesTo).toHaveBeenCalledWith(PHP_PROJECT);
    expect(secondAppliesTo).toHaveBeenCalledOnce();
    expect(secondAppliesTo).toHaveBeenCalledWith(PHP_PROJECT);
    expect(firstForProject).toHaveBeenCalledOnce();
    expect(firstForProject).toHaveBeenCalledWith(PHP_PROJECT);
    expect(secondForProject).not.toHaveBeenCalled();
    expect(selection).toEqual({
      activityLabel: "Project First",
      matchedProviderIds: ["first", "second"],
      providers: [projectProvider],
    });
  });

  it("does not specialize or present a provider when nothing matches", () => {
    const forProject = vi.fn(
      (_: PhpProjectDescriptor): TestProvider => ({ id: "inactive" }),
    );
    const inactive: TestProvider = {
      id: "inactive",
      appliesTo: () => false,
      presentation: { activityLabel: "Inactive" },
    };

    expect(
      selectPhpFrameworkProvidersForProject(
        PHP_PROJECT,
        [inactive],
        (_provider, php) => forProject(php),
      ),
    ).toEqual({
      activityLabel: null,
      matchedProviderIds: [],
      providers: [],
    });
    expect(forProject).not.toHaveBeenCalled();
  });

  it("rejects a same-id specialization owned by another registration", () => {
    const first: TestProvider = { id: "shared" };
    const second: TestProvider = { id: "shared" };

    registerPhpFrameworkProviderProjectSpecializer(first, () => first);
    registerPhpFrameworkProviderProjectSpecializer(second, () => first);

    expect(() =>
      specializePhpFrameworkProviderForProject(second, PHP_PROJECT),
    ).toThrow(
      'PHP framework project specialization returned provider "shared" owned by another registration.',
    );
  });
});
