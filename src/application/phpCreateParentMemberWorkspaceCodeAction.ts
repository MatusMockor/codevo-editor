import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import {
  planPhpCreateFromUsage,
  type MissingThisMember,
} from "../domain/phpCreateFromUsage";
import { buildPhpCreateMemberWorkspaceEdit } from "../domain/phpCreateParentMemberEdit";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

const VENDOR_PSR4_PREFIXES = ["Composer\\", "Illuminate\\", "Symfony\\"];

export interface PhpCreateMemberWorkspaceCodeActionOptions {
  getOpenDocumentSyncVersion: (path: string) => number | null;
  readOpenDocumentContent: (path: string) => string | null;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceRoot: string | null;
}

export function buildPhpCreateMemberWorkspaceCodeAction({
  getOpenDocumentSyncVersion,
  readOpenDocumentContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceRoot,
}: PhpCreateMemberWorkspaceCodeActionOptions): (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null> {
  return async (
    source,
    range,
    isRequestedRootActive,
  ): Promise<PhpCodeActionDescriptor | null> => {
    const requestedRoot = workspaceRoot;

    if (!requestedRoot) {
      return null;
    }

    const plan = planPhpCreateFromUsage(source, range.start);

    if (!plan || plan.sameFileParent || plan.sameFileExternal) {
      return null;
    }

    const member = plan.member;
    const classReference = memberClassReference(member);

    if (!classReference) {
      return null;
    }

    const fqn = resolvePhpClassName(source, classReference);

    if (!fqn) {
      return null;
    }

    const normalized = fqn.replace(/^\\+/, "");

    if (isUnderVendorPsr4Prefix(normalized)) {
      return null;
    }

    const separatorIndex = normalized.lastIndexOf("\\");
    const targetClassName = normalized.slice(separatorIndex + 1);
    const expectedNamespace =
      separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : null;
    const candidatePaths = await resolvePhpClassSourcePaths(normalized);

    if (!isRequestedRootActive()) {
      return null;
    }

    const targetPath = candidatePaths[0];

    if (candidatePaths.length !== 1 || !targetPath) {
      return null;
    }

    if (!isWritableWorkspacePath(targetPath, requestedRoot)) {
      return null;
    }

    const openTargetSource = readOpenDocumentContent(targetPath);
    const targetSource =
      openTargetSource !== null
        ? openTargetSource
        : await readTestFileIfExists(targetPath);

    if (!isRequestedRootActive()) {
      return null;
    }

    if (targetSource === null) {
      return null;
    }

    const targetFileUri = targetFileUriFromPath(targetPath);

    if (!targetFileUri) {
      return null;
    }

    const workspaceEdit = buildPhpCreateMemberWorkspaceEdit({
      expectedNamespace,
      member,
      targetClassName,
      targetFileUri,
      targetSource,
    });

    if (!workspaceEdit) {
      return null;
    }

    const syncVersion =
      openTargetSource !== null ? getOpenDocumentSyncVersion(targetPath) : null;

    return {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      title: `Create ${member.kind} '${member.name}' in '${targetClassName}'`,
      workspaceEdit:
        syncVersion !== null
          ? {
              ...workspaceEdit,
              documentVersions: { [targetFileUri]: syncVersion },
            }
          : workspaceEdit,
    };
  };
}

function memberClassReference(member: MissingThisMember): string | null {
  if (member.target === "parent") {
    return member.parentClass ?? null;
  }

  if (member.target === "external") {
    return member.targetClass ?? null;
  }

  return null;
}

function isUnderVendorPsr4Prefix(fqn: string): boolean {
  const lower = fqn.toLowerCase();

  return VENDOR_PSR4_PREFIXES.some((prefix) =>
    lower.startsWith(prefix.toLowerCase()),
  );
}

function isWritableWorkspacePath(path: string, workspaceRoot: string): boolean {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const rootPrefix = `${normalizedRoot}/`;

  if (!path.startsWith(rootPrefix)) {
    return false;
  }

  return !path.startsWith(`${rootPrefix}vendor/`);
}

function targetFileUriFromPath(path: string): string | null {
  try {
    return fileUriFromPath(path);
  } catch {
    return null;
  }
}
