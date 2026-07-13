import { joinWorkspacePath } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export type MissingViewReferenceDetector = (
  source: string,
  offset: number,
  language: "blade" | "php",
  viewNames: readonly string[],
) => { name: string; relativePath: string } | null;

export interface CreateMissingBladeViewCodeActionOptions {
  canCreateMissingViewFiles: boolean;
  collectViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  detectMissingViewReference: MissingViewReferenceDetector;
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
  canCreateMissingViewFiles,
  collectViewTargets,
  detectMissingViewReference,
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

    if (!requestedRoot || !canCreateMissingViewFiles) {
      return null;
    }

    const viewTargets = await collectViewTargets();

    if (!isRequestedRootActive()) {
      return null;
    }

    const missing = detectMissingViewReference(
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
