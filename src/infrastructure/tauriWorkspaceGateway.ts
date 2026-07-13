import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FileEntry,
  FileSearchGateway,
  FileSearchResult,
  ManagedPhpactorInstallCompletionEvent,
  ManagedPhpactorInstallUnsubscribeFn,
  ManagedTypeScriptInstallCompletionEvent,
  PhpToolGateway,
  PhpToolAvailability,
  ReplaceInPathResult,
  TextSearchGateway,
  TextSearchOptions,
  TextSearchResult,
  WorkspaceDescriptor,
  WorkspaceDetectionGateway,
  WorkspaceFileGateway,
  WorkspaceWriteResult,
  WorkspaceFileRevision,
  WorkspaceMutationResult,
  WorkspaceImageFile,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
} from "./tauriWorkspaceIdentityGateway";
import { workspaceRelativePathForDescriptor } from "./tauriWorkspaceIdentityGateway";

const MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT =
  "php://managed-phpactor-install-completed";
const MANAGED_TYPESCRIPT_INSTALL_COMPLETED_EVENT =
  "typescript://managed-language-server-install-completed";
import {
  pathFromLanguageServerUri,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileOperation,
} from "../domain/languageServerFeatures";

export class TauriWorkspaceGateway
  implements
    FileSearchGateway,
    PhpToolGateway,
    TextSearchGateway,
    WorkspaceDetectionGateway,
    WorkspaceFileGateway
{
  constructor(
    private readonly workspaceIdentities?: WorkspaceIdentityDescriptorResolver,
  ) {}

  applyWorkspaceEdit(
    rootPath: string,
    edit: LanguageServerWorkspaceEdit,
    skippedPaths: string[],
  ): Promise<number> {
    const target = this.optionalTrustedTarget(rootPath);
    if (target) {
      const descriptor = this.workspaceIdentities?.descriptorForPath(rootPath);
      if (!descriptor) {
        return Promise.reject(new Error("The trusted workspace descriptor is no longer available."));
      }
      return invoke<WorkspaceEditResult>("workspace_apply_workspace_edit", {
        workspaceId: target.workspaceId,
        edit: relativeWorkspaceEdit(descriptor, edit),
        skippedPaths: skippedPaths.flatMap((path) => {
          const relativePath = workspaceRelativePathForDescriptor(descriptor, path);
          return relativePath === null ? [] : [relativePath];
        }),
      }).then(workspaceEditCount);
    }

    return invoke<number>("apply_workspace_edit", {
      edit,
      rootPath,
      skippedPaths,
    });
  }

  createDirectory(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_create_directory", target).then(assertMutationSucceeded);
  }

  createTextFile(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_create_text_file", target).then(assertMutationSucceeded);
  }

  deletePath(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_delete_path", target).then(assertMutationSucceeded);
  }

  detectPhpTools(workspaceRoot: string | null): Promise<PhpToolAvailability> {
    return invoke<PhpToolAvailability>("detect_php_tools", { workspaceRoot });
  }

  installManagedPhpactor(root: string): Promise<void> {
    return invoke<void>("install_managed_phpactor", { root });
  }

  subscribeManagedPhpactorInstall(
    listener: (event: ManagedPhpactorInstallCompletionEvent) => void,
  ): Promise<ManagedPhpactorInstallUnsubscribeFn> {
    if (!isTauri()) {
      return Promise.resolve(() => undefined);
    }

    return listen<ManagedPhpactorInstallCompletionEvent>(
      MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT,
      (event) => {
        listener(event.payload);
      },
    );
  }

  installManagedTypeScriptLanguageServer(root: string): Promise<void> {
    return invoke<void>("install_managed_typescript_language_server", { root });
  }

  subscribeManagedTypeScriptLanguageServerInstall(
    listener: (event: ManagedTypeScriptInstallCompletionEvent) => void,
  ): Promise<ManagedPhpactorInstallUnsubscribeFn> {
    if (!isTauri()) return Promise.resolve(() => undefined);
    return listen<ManagedTypeScriptInstallCompletionEvent>(
      MANAGED_TYPESCRIPT_INSTALL_COMPLETED_EVENT,
      (event) => listener(event.payload),
    );
  }

  detectWorkspace(path: string): Promise<WorkspaceDescriptor> {
    return invoke<WorkspaceDescriptor>("detect_workspace", { path });
  }

  readDirectory(path: string): Promise<FileEntry[]> {
    const target = this.optionalTrustedTarget(path);
    if (target) {
      return invoke<DescriptorFileEntry[]>("workspace_read_directory", target).then((entries) =>
        entries.map((entry) => ({ name: entry.name, kind: entry.kind, path: joinWorkspacePath(path, entry.relativePath) })),
      );
    }

    return invoke<FileEntry[]>("read_directory", { path });
  }

  async readImageFile(path: string): Promise<WorkspaceImageFile> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceImageFile>("workspace_read_image_file", target);
  }

  readTextFile(path: string): Promise<string> {
    return this.readTextFileSnapshot(path).then((snapshot) => snapshot.content);
  }

  readTextFileSnapshot(path: string): Promise<WorkspaceTextFileSnapshot> {
    const target = this.optionalTrustedTarget(path);
    if (target) {
      return invoke<WorkspaceTextFileSnapshot>("workspace_read_text_file", target);
    }

    return invoke<string>("read_text_file", { path }).then((content) => ({
      content,
      revision: null,
    }));
  }

  renamePath(from: string, to: string): Promise<void> {
    const source = this.trustedTarget(from);
    const destination = this.trustedTarget(to);
    if (source.workspaceId !== destination.workspaceId) {
      return Promise.reject(new Error("Files cannot be moved between trusted workspaces."));
    }

    return invoke<WorkspaceMutationResult>("workspace_rename_path", {
      workspaceId: source.workspaceId,
      fromRelativePath: source.relativePath,
      toRelativePath: destination.relativePath,
      overwrite: false,
    }).then(assertMutationSucceeded);
  }

  searchFiles(
    root: string,
    query: string,
    limit: number,
  ): Promise<FileSearchResult[]> {
    const target = this.optionalTrustedTarget(root);
    if (target) {
      return invoke<DescriptorFileSearchResult[]>("workspace_search_files", { ...target, query, limit }).then((results) =>
        results.map((result) => ({ ...result, path: joinWorkspacePath(root, result.relativePath) })),
      );
    }

    return invoke<FileSearchResult[]>("search_files", { root, query, limit });
  }

  searchText(
    root: string,
    query: string,
    limit: number,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]> {
    const target = this.optionalTrustedTarget(root);
    if (target) {
      return invoke<DescriptorTextSearchResult[]>("workspace_search_text", { ...target, query, limit, options: options ?? null }).then((results) =>
        results.map((result) => ({ ...result, path: joinWorkspacePath(root, result.relativePath) })),
      );
    }

    return invoke<TextSearchResult[]>("search_text", {
      root,
      query,
      limit,
      options: options ?? null,
    });
  }

  replaceInPath(
    root: string,
    query: string,
    replacement: string,
    options?: TextSearchOptions,
    scopePath?: string,
  ): Promise<ReplaceInPathResult> {
    const rootTarget = this.trustedTarget(root);
    const scopeTarget = scopePath ? this.trustedTarget(scopePath) : rootTarget;
    if (scopeTarget.workspaceId !== rootTarget.workspaceId) {
      return Promise.reject(new Error("Replace scope must belong to the selected workspace."));
    }
    return invoke<DescriptorReplaceResult>("workspace_replace_in_path", {
      workspaceId: rootTarget.workspaceId,
      relativePath: scopeTarget.relativePath,
      query,
      replacement,
      options: options ?? null,
    }).then((result) => mapReplaceResult(root, result));
  }

  writeTextFile(
    path: string,
    content: string,
    expectedRevision?: WorkspaceFileRevision,
  ): Promise<WorkspaceWriteResult> {
    const target = this.trustedTarget(path);
    if (!expectedRevision) {
      throw new Error(
        "Cannot save without the revision from the loaded document. Reload the file and try again.",
      );
    }
    return invoke<WorkspaceWriteResult>("workspace_save_text_file", {
      ...target,
      content,
      expectedRevision,
    });
  }

  private trustedTarget(path: string): TrustedWorkspaceTarget {
    const target = this.optionalTrustedTarget(path);
    if (target) {
      return target;
    }

    throw new Error(
      "This restored workspace is read-only. Reopen it explicitly to enable file changes.",
    );
  }

  private optionalTrustedTarget(path: string): TrustedWorkspaceTarget | null {
    const descriptor = this.workspaceIdentities?.descriptorForPath(path) ?? null;
    if (!descriptor) {
      return null;
    }

    const relativePath = workspaceRelativePathForDescriptor(descriptor, path);
    if (relativePath === null) {
      throw new Error("The requested path is outside the active trusted workspace.");
    }

    return {
      workspaceId: descriptor.workspaceId,
      relativePath,
    };
  }
}

function assertMutationSucceeded(result: WorkspaceMutationResult | undefined): void {
  if (!result || result.status === "success") return;
  throw new Error(result.message);
}

type TrustedWorkspaceTarget = Record<string, unknown> & {
  workspaceId: string;
  relativePath: string;
};
type DescriptorFileEntry = Omit<FileEntry, "path"> & { relativePath: string };
type DescriptorFileSearchResult = Omit<FileSearchResult, "path">;
type DescriptorTextSearchResult = Omit<TextSearchResult, "path">;
type DescriptorReplaceFile = Omit<ReplaceInPathResult["files"][number], "path">;
type DescriptorReplaceFailure = { relativePath: string; message: string };
type DescriptorReplaceResult =
  | { status: "success"; files: DescriptorReplaceFile[]; totalReplacements: number }
  | { status: "conflict"; files: DescriptorReplaceFile[]; totalReplacements: number; conflicts: DescriptorReplaceFailure[]; message: string }
  | { status: "partial"; files: DescriptorReplaceFile[]; totalReplacements: number; conflicts: DescriptorReplaceFailure[]; errors: DescriptorReplaceFailure[]; message: string }
  | { status: "error"; files: DescriptorReplaceFile[]; totalReplacements: number; errors: DescriptorReplaceFailure[]; message: string };
type WorkspaceEditResult = {
  status: "success" | "conflict" | "partial" | "error" | "notFound";
  appliedCount: number;
  appliedFileOperations: number;
  appliedTextFiles: number;
  failedPath?: string;
  message?: string;
};

function workspaceEditCount(result: WorkspaceEditResult): number {
  if (result.status === "success") return result.appliedCount;
  throw new Error(`${result.failedPath ?? "workspace edit"}: ${result.message ?? result.status}`);
}

function relativeWorkspaceEdit(
  descriptor: WorkspaceIdentityDescriptor,
  edit: LanguageServerWorkspaceEdit,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(Object.entries(edit.changes).flatMap(([uri, edits]) => {
    const relativePath = relativePathFromUri(descriptor, uri);
    return relativePath === null ? [] : [[relativePath, edits]];
  }));
  const fileOperations = edit.fileOperations?.flatMap((operation) => {
    const relativeOperation = relativeFileOperation(descriptor, operation);
    return relativeOperation ? [relativeOperation] : [];
  });
  const documentVersions = edit.documentVersions
    ? Object.fromEntries(Object.entries(edit.documentVersions).flatMap(([uri, version]) => {
        const relativePath = relativePathFromUri(descriptor, uri);
        return relativePath === null ? [] : [[relativePath, version]];
      }))
    : undefined;
  return { ...edit, changes, documentVersions, fileOperations };
}

function relativeFileOperation(
  descriptor: WorkspaceIdentityDescriptor,
  operation: LanguageServerWorkspaceFileOperation,
): LanguageServerWorkspaceFileOperation | null {
  if (operation.kind !== "rename") {
    const uri = relativePathFromUri(descriptor, operation.uri);
    return uri === null ? null : { ...operation, uri };
  }
  const oldUri = relativePathFromUri(descriptor, operation.oldUri);
  const newUri = relativePathFromUri(descriptor, operation.newUri);
  if (oldUri === null || newUri === null) return null;
  return { ...operation, oldUri, newUri };
}

function relativePathFromUri(descriptor: WorkspaceIdentityDescriptor, uri: string): string | null {
  const path = pathFromLanguageServerUri(uri);
  if (path === null) return null;
  const relativePath = workspaceRelativePathForDescriptor(descriptor, path);
  return relativePath;
}

function mapReplaceResult(root: string, result: DescriptorReplaceResult): ReplaceInPathResult {
  const files = result.files.map((file) => ({ ...file, path: joinWorkspacePath(root, file.relativePath) }));
  if (result.status === "success") return { ...result, files };
  const mapFailures = (items: DescriptorReplaceFailure[]) => items.map((item) => ({ ...item, path: joinWorkspacePath(root, item.relativePath) }));
  if (result.status === "conflict") return { ...result, files, conflicts: mapFailures(result.conflicts) };
  if (result.status === "partial") return { ...result, files, conflicts: mapFailures(result.conflicts), errors: mapFailures(result.errors) };
  return { ...result, files, errors: mapFailures(result.errors) };
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}
