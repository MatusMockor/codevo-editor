import {
  buildCreateMissingBladeViewCodeAction,
  type CreateMissingBladeViewCodeAction,
} from "./phpBladeViewCodeActions";
import {
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkCodeActionContribution } from "./phpCodeActionWorkspaceCollector";
import { phpNettePresenterLinkCodeActions } from "./phpNettePresenterLinkCodeActions";

export interface PhpFrameworkCodeActionContributionDependencies {
  collectViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  workspaceRoot: string | null;
}

interface ActivePhpFrameworkCodeActionContribution {
  readonly createMissingBladeViewCodeAction?: CreateMissingBladeViewCodeAction;
  readonly providePhpCodeAction: PhpFrameworkCodeActionContribution;
}

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
    "providers" | "supports"
  >;
  legacyIsLaravelFrameworkActive: boolean;
}): ActivePhpFrameworkCodeActions {
  const providers = frameworkRuntime
    ? frameworkRuntime.supports("codeActions")
      ? frameworkRuntime.providers
      : []
    : legacyIsLaravelFrameworkActive
      ? [phpLaravelFrameworkProvider]
      : [];
  const activeContributions = providers.flatMap((provider) =>
    phpFrameworkCodeActionContributionsForProvider(provider, dependencies),
  );

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

function phpFrameworkCodeActionContributionsForProvider(
  provider: PhpFrameworkProvider,
  dependencies: PhpFrameworkCodeActionContributionDependencies,
): ActivePhpFrameworkCodeActionContribution[] {
  const codeActions = provider.codeActions;

  if (!codeActions) {
    return [];
  }

  const contributions: ActivePhpFrameworkCodeActionContribution[] = [];
  const missingTemplateFile = codeActions.missingTemplateFile;

  if (missingTemplateFile) {
    const createMissingBladeViewCodeAction =
      buildCreateMissingBladeViewCodeAction({
        ...dependencies,
        canCreateMissingViewFiles: true,
        detectMissingViewReference: missingTemplateFile.detectMissingReference,
      });

    contributions.push({
      createMissingBladeViewCodeAction,
      providePhpCodeAction: async (source, range, isRequestedRootActive) => {
        const action = await createMissingBladeViewCodeAction(
          source,
          range,
          "php",
          isRequestedRootActive,
        );

        return action ? [action] : null;
      },
    });
  }

  if (codeActions.phpPresenterLinkMethod === true) {
    contributions.push({
      providePhpCodeAction: async (source, range, isRequestedRootActive) =>
        isRequestedRootActive()
          ? phpNettePresenterLinkCodeActions(source, range)
          : null,
    });
  }

  return contributions;
}
