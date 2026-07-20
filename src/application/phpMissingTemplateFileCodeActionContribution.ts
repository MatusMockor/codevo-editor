import {
  buildCreateMissingViewFileCodeAction,
  type CreateMissingViewFileCodeAction,
  type MissingViewReferenceDetector,
} from "./phpBladeViewCodeActions";
import type {
  ActivePhpFrameworkCodeActionContribution,
  PhpFrameworkCodeActionContributionAdapter,
} from "./phpFrameworkCodeActionContributions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpMissingTemplateFileCodeActionDependencies {
  collectViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  workspaceRoot: string | null;
}

export function createPhpMissingTemplateFileCodeActionContribution(
  dependencies: PhpMissingTemplateFileCodeActionDependencies,
): PhpFrameworkCodeActionContributionAdapter {
  return {
    contributionsFor(provider) {
      const missingTemplateFile = provider.codeActions?.missingTemplateFile;

      if (!missingTemplateFile) {
        return [];
      }

      const createMissingTemplateFileCodeAction =
        buildCreateMissingTemplateFileCodeAction({
          dependencies,
          detectMissingReference: missingTemplateFile.detectMissingReference,
        });

      return [
        createMissingTemplateContribution(createMissingTemplateFileCodeAction),
      ];
    },
    id: "missing-template-file",
    priority: 100,
  };
}

const NO_MISSING_TEMPLATE_FILE_CODE_ACTION: CreateMissingViewFileCodeAction =
  async () => null;

export function createActiveMissingTemplateFileCodeAction({
  frameworkRuntime,
  ...dependencies
}: PhpMissingTemplateFileCodeActionDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers" | "supports">;
}): CreateMissingViewFileCodeAction {
  if (!frameworkRuntime.supports("codeActions")) {
    return NO_MISSING_TEMPLATE_FILE_CODE_ACTION;
  }

  const missingTemplateFile = frameworkRuntime.providers.find(
    (provider) => provider.codeActions?.missingTemplateFile,
  )?.codeActions?.missingTemplateFile;

  if (!missingTemplateFile) {
    return NO_MISSING_TEMPLATE_FILE_CODE_ACTION;
  }

  return buildCreateMissingTemplateFileCodeAction({
    dependencies,
    detectMissingReference: missingTemplateFile.detectMissingReference,
  });
}

function buildCreateMissingTemplateFileCodeAction({
  dependencies,
  detectMissingReference,
}: {
  dependencies: PhpMissingTemplateFileCodeActionDependencies;
  detectMissingReference: MissingViewReferenceDetector;
}): CreateMissingViewFileCodeAction {
  return buildCreateMissingViewFileCodeAction({
    ...dependencies,
    canCreateMissingViewFiles: true,
    detectMissingViewReference: detectMissingReference,
  });
}

function createMissingTemplateContribution(
  createMissingTemplateFileCodeAction: CreateMissingViewFileCodeAction,
): ActivePhpFrameworkCodeActionContribution {
  return {
    id: "missing-template-file",
    providePhpCodeAction: async (source, range, isRequestedRootActive) => {
      const action = await createMissingTemplateFileCodeAction(
        source,
        range,
        "php",
        isRequestedRootActive,
      );

      return action ? [action] : null;
    },
  };
}
