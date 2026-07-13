import { missingLaravelViewReferenceAt } from "../domain/laravelDiagnostics";
import { joinWorkspacePath } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface CreateMissingBladeViewCodeActionOptions {
  canCreateMissingBladeViews: boolean;
  collectViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  workspaceRoot: string | null;
}

export type CreateMissingBladeViewCodeAction = (
  source: string,
  range: PhpCodeActionRange,
  language: "blade" | "php",
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null>;

export function buildCreateMissingBladeViewCodeAction({
  canCreateMissingBladeViews,
  collectViewTargets,
  readTestFileIfExists,
  workspaceRoot,
}: CreateMissingBladeViewCodeActionOptions): CreateMissingBladeViewCodeAction {
  return async (
    source,
    range,
    language,
    isRequestedRootActive,
  ): Promise<PhpCodeActionDescriptor | null> => {
    const requestedRoot = workspaceRoot;

    if (!requestedRoot || !canCreateMissingBladeViews) {
      return null;
    }

    const viewTargets = await collectViewTargets();

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
