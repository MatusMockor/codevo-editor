import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { planPhpCreateFromUsage } from "../domain/phpCreateFromUsage";
import { buildPhpCreateParentMemberEdit } from "../domain/phpCreateParentMemberEdit";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface PhpCreateParentMemberWorkspaceCodeActionOptions {
  getOpenDocumentSyncVersion: (path: string) => number | null;
  readOpenDocumentContent: (path: string) => string | null;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
}

export function buildPhpCreateParentMemberWorkspaceCodeAction({
  getOpenDocumentSyncVersion,
  readOpenDocumentContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
}: PhpCreateParentMemberWorkspaceCodeActionOptions): (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null> {
  return async (
    source,
    range,
    isRequestedRootActive,
  ): Promise<PhpCodeActionDescriptor | null> => {
    const plan = planPhpCreateFromUsage(source, range.start);

    if (!plan || plan.sameFileParent) {
      return null;
    }

    const member = plan.member;

    if (member.target !== "parent" || !member.parentClass) {
      return null;
    }

    const fqn = resolvePhpClassName(source, member.parentClass);

    if (!fqn) {
      return null;
    }

    const normalized = fqn.replace(/^\\+/, "");
    const separatorIndex = normalized.lastIndexOf("\\");
    const parentClassName = normalized.slice(separatorIndex + 1);
    const expectedParentNamespace =
      separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : null;
    const candidatePaths = await resolvePhpClassSourcePaths(normalized);

    if (!isRequestedRootActive()) {
      return null;
    }

    const parentPath = candidatePaths[0];

    if (candidatePaths.length !== 1 || !parentPath) {
      return null;
    }

    const openParentSource = readOpenDocumentContent(parentPath);
    const parentSource =
      openParentSource !== null
        ? openParentSource
        : await readTestFileIfExists(parentPath);

    if (!isRequestedRootActive()) {
      return null;
    }

    if (parentSource === null) {
      return null;
    }

    const parentFileUri = parentFileUriFromPath(parentPath);

    if (!parentFileUri) {
      return null;
    }

    const workspaceEdit = buildPhpCreateParentMemberEdit({
      expectedParentNamespace,
      member,
      parentClassName,
      parentFileUri,
      parentSource,
    });

    if (!workspaceEdit) {
      return null;
    }

    const syncVersion =
      openParentSource !== null ? getOpenDocumentSyncVersion(parentPath) : null;

    return {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      title: `Create ${member.kind} '${member.name}' in '${parentClassName}'`,
      workspaceEdit:
        syncVersion !== null
          ? {
              ...workspaceEdit,
              documentVersions: { [parentFileUri]: syncVersion },
            }
          : workspaceEdit,
    };
  };
}

function parentFileUriFromPath(path: string): string | null {
  try {
    return fileUriFromPath(path);
  } catch {
    return null;
  }
}
