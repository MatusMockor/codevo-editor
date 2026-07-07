import { missingLaravelViewReferenceAt } from "../domain/laravelDiagnostics";
import { joinWorkspacePath } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface CreateMissingBladeViewCodeActionOptions {
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  isLaravelFrameworkActive: boolean;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  workspaceRoot: string | null;
}

export function buildCreateMissingBladeViewCodeAction({
  collectPhpLaravelViewTargets,
  isLaravelFrameworkActive,
  readTestFileIfExists,
  workspaceRoot,
}: CreateMissingBladeViewCodeActionOptions): (
  source: string,
  range: PhpCodeActionRange,
  language: "blade" | "php",
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null> {
  return async (
    source,
    range,
    language,
    isRequestedRootActive,
  ): Promise<PhpCodeActionDescriptor | null> => {
    const requestedRoot = workspaceRoot;

    if (!requestedRoot || !isLaravelFrameworkActive) {
      return null;
    }

    const viewTargets = await collectPhpLaravelViewTargets();

    if (!isRequestedRootActive()) {
      return null;
    }

    const missing = missingLaravelViewReferenceAt(
      source,
      range.start,
      language,
      viewTargets.map((target) => target.name),
    );

    if (!missing) {
      return null;
    }

    const path = joinWorkspacePath(requestedRoot, missing.relativePath);
    const existing = await readTestFileIfExists(path);

    if (!isRequestedRootActive() || existing !== null) {
      return null;
    }

    return {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: {
        content: "",
        path,
        title: "Create Blade View",
      },
      title: `Create Blade view ${missing.name}`,
    };
  };
}
