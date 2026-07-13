import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { phpCreateClassDestination } from "../domain/phpCreateClass";
import {
  planPhpCreateFromUsage,
  type MissingThisMember,
} from "../domain/phpCreateFromUsage";
import { buildPhpCreateMemberWorkspaceEdit } from "../domain/phpCreateParentMemberEdit";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

const VENDOR_PSR4_PREFIXES = ["Composer\\", "Illuminate\\", "Symfony\\"];
const COMMON_PROJECT_PSR4_ROOTS = [
  { dev: false, namespace: "App\\", paths: ["app/"] },
];

export interface PhpCreateMemberWorkspaceCodeActionOptions {
  getOpenDocumentSyncVersion: (path: string) => number | null;
  readOpenDocumentContent: (path: string) => string | null;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function buildPhpCreateMemberWorkspaceCodeAction({
  getOpenDocumentSyncVersion,
  readOpenDocumentContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
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

    const plan = firstCreateMemberPlanInRange(source, range);

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
    const candidatePaths = await createMemberTargetCandidatePaths({
      fqn: normalized,
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot: requestedRoot,
    });

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
      workspaceRoot: requestedRoot,
    };
  };
}

function firstCreateMemberPlanInRange(
  source: string,
  range: PhpCodeActionRange,
): ReturnType<typeof planPhpCreateFromUsage> {
  const offsets = createMemberPlanCandidateOffsets(source, range);

  for (const offset of offsets) {
    const plan = planPhpCreateFromUsage(source, offset);

    if (plan) {
      return plan;
    }
  }

  return null;
}

function createMemberPlanCandidateOffsets(
  source: string,
  range: PhpCodeActionRange,
): number[] {
  const lower = Math.max(0, Math.min(range.start, range.end));
  const upper = Math.min(source.length, Math.max(range.start, range.end));
  const scanStart = Math.max(0, lower - 80);
  const scanEnd = Math.min(source.length, upper + 80);
  const offsets = new Set<number>([
    lower,
    upper,
    Math.max(0, upper - 1),
  ]);
  const nearby = source.slice(scanStart, scanEnd);
  const accessPattern =
    /(?:\$this->|\b(?:self|static|parent)::|\$[A-Za-z_][A-Za-z0-9_]*->|\\?[A-Za-z_][A-Za-z0-9_\\]*::)\s*([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const match of nearby.matchAll(accessPattern)) {
    const matchStart = scanStart + (match.index ?? 0);
    const memberIndex = match[0].lastIndexOf(match[1] ?? "");

    if (memberIndex < 0) {
      continue;
    }

    const memberStart = matchStart + memberIndex;

    offsets.add(matchStart);
    offsets.add(memberStart);
    offsets.add(memberStart + (match[1]?.length ?? 0));
  }

  return [...offsets].filter((offset) => offset >= 0 && offset <= source.length);
}

async function createMemberTargetCandidatePaths({
  fqn,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: {
  fqn: string;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string;
}): Promise<string[]> {
  const indexedPaths = await resolvePhpClassSourcePaths(fqn);

  if (indexedPaths.length === 1) {
    return indexedPaths;
  }

  const fallback = phpCreateClassDestination(
    workspaceRoot,
    createMemberTargetPsr4Roots(
      workspaceDescriptor,
      fqn,
      indexedPaths.length === 0,
    ),
    VENDOR_PSR4_PREFIXES,
    fqn,
  );

  if (!fallback) {
    return indexedPaths;
  }

  return (await readTestFileIfExists(fallback.path)) === null
    ? indexedPaths
    : [fallback.path];
}

function createMemberTargetPsr4Roots(
  workspaceDescriptor: WorkspaceDescriptor | null,
  fqn: string,
  includeCommonRoots: boolean,
) {
  const roots = workspaceDescriptor?.php?.psr4Roots ?? [];
  const namespaces = new Set(roots.map((root) => root.namespace));
  const commonRoots = includeCommonRoots
    ? COMMON_PROJECT_PSR4_ROOTS.filter(
        (root) =>
          fqn.startsWith(root.namespace) && !namespaces.has(root.namespace),
      )
    : [];

  return [...roots, ...commonRoots];
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
