import {
  phpFrameworkJsonTranslationKeysFromSource,
  phpFrameworkJsonTranslationTargetFromSource,
  phpFrameworkTranslationKeysFromSource,
  phpFrameworkTranslationTargetFromSource,
} from "../domain/phpFrameworkProviders";
import {
  isUsableLaravelTranslationLocale,
  phpLaravelJsonTranslationLocaleFromRelativePath,
  phpLaravelTranslationFileNameFromKey,
  phpLaravelTranslationFileNameFromRelativePath,
  type PhpLaravelTranslationTarget,
} from "../domain/phpLaravelTranslations";
import { getFileName, type FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface PhpLaravelTranslationFile {
  path: string;
  relativePath: string;
}

export interface PhpLaravelTranslationTargetResolverDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readCachedTranslationTargets: (
    workspaceRoot: string,
  ) => PhpLaravelTranslationTarget[] | null;
  writeCachedTranslationTargets: (
    workspaceRoot: string,
    targets: PhpLaravelTranslationTarget[],
  ) => void;
}

export interface PhpLaravelTranslationTargetResolver {
  collect: () => Promise<PhpLaravelTranslationTarget[]>;
  find: (translationKey: string) => Promise<PhpLaravelTranslationTarget | null>;
}

function isWorkspaceRootActive(
  deps: PhpLaravelTranslationTargetResolverDeps,
  requestedRoot: string | null,
): boolean {
  return workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
}

function supportsTranslations(
  deps: PhpLaravelTranslationTargetResolverDeps,
): boolean {
  return deps.frameworkRuntime.supports("translations");
}

async function collectPhpLaravelTranslationLocaleRoots(
  deps: PhpLaravelTranslationTargetResolverDeps,
  requestedRoot: string,
): Promise<string[]> {
  const localeRoots: string[] = [];

  for (const translationBase of ["lang", "resources/lang"]) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    try {
      const entries = await deps.readWorkspaceDirectory(
        deps.joinWorkspacePath(requestedRoot, translationBase),
      );

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      for (const entry of entries) {
        if (
          entry.kind === "directory" &&
          isUsableLaravelTranslationLocale(entry.name)
        ) {
          localeRoots.push(`${translationBase}/${entry.name}`);
        }
      }
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }
    }
  }

  return localeRoots.sort((left, right) => {
    const leftLocale = getFileName(left);
    const rightLocale = getFileName(right);

    if (leftLocale === "en" && rightLocale !== "en") {
      return -1;
    }

    if (rightLocale === "en" && leftLocale !== "en") {
      return 1;
    }

    return left.localeCompare(right);
  });
}

async function collectPhpLaravelJsonTranslationFiles(
  deps: PhpLaravelTranslationTargetResolverDeps,
  requestedRoot: string,
): Promise<PhpLaravelTranslationFile[]> {
  const files = new Map<string, PhpLaravelTranslationFile>();

  for (const translationBase of ["lang", "resources/lang"]) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    try {
      const entries = await deps.readWorkspaceDirectory(
        deps.joinWorkspacePath(requestedRoot, translationBase),
      );

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      for (const entry of entries) {
        if (entry.kind === "directory") {
          continue;
        }

        const relativePath = deps.relativeWorkspacePath(requestedRoot, entry.path);

        if (!phpLaravelJsonTranslationLocaleFromRelativePath(relativePath)) {
          continue;
        }

        const key = relativePath.toLowerCase();

        if (!files.has(key)) {
          files.set(key, {
            path: entry.path,
            relativePath,
          });
        }
      }
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }
    }
  }

  return Array.from(files.values()).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function collectPhpLaravelTranslationTargets(
  deps: PhpLaravelTranslationTargetResolverDeps,
): Promise<PhpLaravelTranslationTarget[]> {
  const requestedRoot = deps.workspaceRoot;

  if (!supportsTranslations(deps) || !requestedRoot) {
    return [];
  }

  const cachedTranslations = deps.readCachedTranslationTargets(requestedRoot);

  if (cachedTranslations) {
    return cachedTranslations;
  }

  const targets = new Map<string, PhpLaravelTranslationTarget>();
  const translationRoots = await collectPhpLaravelTranslationLocaleRoots(
    deps,
    requestedRoot,
  );

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  for (const translationRoot of translationRoots) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    const rootPath = deps.joinWorkspacePath(requestedRoot, translationRoot);
    let entries: FileEntry[];

    try {
      entries = await deps.readWorkspaceDirectory(rootPath);
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      continue;
    }

    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    for (const entry of entries) {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      if (entry.kind === "directory") {
        continue;
      }

      const relativePath = deps.relativeWorkspacePath(requestedRoot, entry.path);
      const fileName = phpLaravelTranslationFileNameFromRelativePath(relativePath);

      if (!fileName) {
        continue;
      }

      try {
        const content = await deps.readNavigationFileContent(entry.path);

        if (!isWorkspaceRootActive(deps, requestedRoot)) {
          return [];
        }

        for (const target of phpFrameworkTranslationKeysFromSource(
          content,
          fileName,
          deps.frameworkRuntime.providers,
        )) {
          const key = target.key.toLowerCase();

          if (targets.has(key)) {
            continue;
          }

          targets.set(key, {
            key: target.key,
            path: entry.path,
            position: target.position,
            relativePath,
          });
        }
      } catch {
        if (!isWorkspaceRootActive(deps, requestedRoot)) {
          return [];
        }
      }
    }
  }

  const jsonFiles = await collectPhpLaravelJsonTranslationFiles(deps, requestedRoot);

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  for (const jsonFile of jsonFiles) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    try {
      const content = await deps.readNavigationFileContent(jsonFile.path);

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      for (const target of phpFrameworkJsonTranslationKeysFromSource(
        content,
        deps.frameworkRuntime.providers,
      )) {
        const key = target.key.toLowerCase();

        if (targets.has(key)) {
          continue;
        }

        targets.set(key, {
          key: target.key,
          path: jsonFile.path,
          position: target.position,
          relativePath: jsonFile.relativePath,
        });
      }
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }
    }
  }

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  const result = Array.from(targets.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  deps.writeCachedTranslationTargets(requestedRoot, result);

  return result;
}

async function findPhpLaravelTranslationTarget(
  deps: PhpLaravelTranslationTargetResolverDeps,
  translationKey: string,
): Promise<PhpLaravelTranslationTarget | null> {
  const requestedRoot = deps.workspaceRoot;

  if (!supportsTranslations(deps) || !requestedRoot) {
    return null;
  }

  const fileName = phpLaravelTranslationFileNameFromKey(translationKey);

  if (fileName) {
    const translationRoots = await collectPhpLaravelTranslationLocaleRoots(
      deps,
      requestedRoot,
    );

    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    for (const translationRoot of translationRoots) {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }

      const relativePath = `${translationRoot}/${fileName}.php`;
      const path = deps.joinWorkspacePath(requestedRoot, relativePath);

      try {
        const content = await deps.readNavigationFileContent(path);

        if (!isWorkspaceRootActive(deps, requestedRoot)) {
          return null;
        }

        const target = phpFrameworkTranslationTargetFromSource(
          content,
          fileName,
          translationKey,
          deps.frameworkRuntime.providers,
        );

        if (!target) {
          continue;
        }

        return {
          key: target.key,
          path,
          position: target.position,
          relativePath,
        };
      } catch {
        if (!isWorkspaceRootActive(deps, requestedRoot)) {
          return null;
        }
      }
    }
  }

  const jsonFiles = await collectPhpLaravelJsonTranslationFiles(deps, requestedRoot);

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return null;
  }

  for (const jsonFile of jsonFiles) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    try {
      const content = await deps.readNavigationFileContent(jsonFile.path);

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }

      const target = phpFrameworkJsonTranslationTargetFromSource(
        content,
        translationKey,
        deps.frameworkRuntime.providers,
      );

      if (!target) {
        continue;
      }

      return {
        key: target.key,
        path: jsonFile.path,
        position: target.position,
        relativePath: jsonFile.relativePath,
      };
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }
    }
  }

  return null;
}

export function createPhpLaravelTranslationTargetResolver(
  deps: PhpLaravelTranslationTargetResolverDeps,
): PhpLaravelTranslationTargetResolver {
  return {
    collect: () => collectPhpLaravelTranslationTargets(deps),
    find: (translationKey) =>
      findPhpLaravelTranslationTarget(deps, translationKey),
  };
}
