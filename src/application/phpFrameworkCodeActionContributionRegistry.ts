import {
  buildCreateMissingBladeViewCodeAction,
  type CreateMissingBladeViewCodeAction,
} from "./phpBladeViewCodeActions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkCodeActionContribution } from "./phpCodeActionWorkspaceCollector";

export interface PhpFrameworkCodeActionContributionDependencies {
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  workspaceRoot: string | null;
}

interface PhpFrameworkCodeActionRegistryContribution {
  readonly providerId: string;
  supports(
    frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "supports">,
  ): boolean;
  create(
    dependencies: PhpFrameworkCodeActionContributionDependencies,
  ): ActivePhpFrameworkCodeActionContribution;
}

interface ActivePhpFrameworkCodeActionContribution {
  readonly createMissingBladeViewCodeAction?: CreateMissingBladeViewCodeAction;
  readonly providePhpCodeAction: PhpFrameworkCodeActionContribution;
}

const PHP_FRAMEWORK_CODE_ACTION_CONTRIBUTIONS: readonly PhpFrameworkCodeActionRegistryContribution[] =
  [
    {
      providerId: "laravel",
      supports: (frameworkRuntime) => frameworkRuntime.supports("views"),
      create: (dependencies) => {
        const createMissingBladeViewCodeAction =
          buildCreateMissingBladeViewCodeAction({
            ...dependencies,
            canCreateMissingBladeViews: true,
          });

        return {
          createMissingBladeViewCodeAction,
          providePhpCodeAction: (source, range, isRequestedRootActive) =>
            createMissingBladeViewCodeAction(
              source,
              range,
              "php",
              isRequestedRootActive,
            ),
        };
      },
    },
  ];

const NO_FRAMEWORK_CODE_ACTION: CreateMissingBladeViewCodeAction = async () =>
  null;

export interface ActivePhpFrameworkCodeActions {
  readonly contributions: readonly PhpFrameworkCodeActionContribution[];
  readonly createMissingBladeViewCodeAction: CreateMissingBladeViewCodeAction;
}

export function activePhpFrameworkCodeActions({
  frameworkRuntime,
  legacyIsLaravelFrameworkActive,
  ...dependencies
}: PhpFrameworkCodeActionContributionDependencies & {
  frameworkRuntime?: Pick<
    PhpFrameworkRuntimeContext,
    "hasProvider" | "supports"
  >;
  legacyIsLaravelFrameworkActive: boolean;
}): ActivePhpFrameworkCodeActions {
  const activeContributions = PHP_FRAMEWORK_CODE_ACTION_CONTRIBUTIONS.filter(
    (contribution) => {
      if (!frameworkRuntime) {
        return (
          contribution.providerId === "laravel" &&
          legacyIsLaravelFrameworkActive
        );
      }

      return (
        frameworkRuntime.hasProvider(contribution.providerId) &&
        contribution.supports(frameworkRuntime)
      );
    },
  ).map((contribution) => contribution.create(dependencies));

  return {
    contributions: activeContributions.map(
      (contribution) => contribution.providePhpCodeAction,
    ),
    createMissingBladeViewCodeAction:
      activeContributions.find(
        (contribution) => contribution.createMissingBladeViewCodeAction,
      )?.createMissingBladeViewCodeAction ?? NO_FRAMEWORK_CODE_ACTION,
  };
}
