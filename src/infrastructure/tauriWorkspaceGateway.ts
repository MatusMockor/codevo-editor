import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FileEntry,
  FileSearchGateway,
  FileSearchResult,
  ManagedPhpactorInstallCompletionEvent,
  ManagedPhpactorInstallUnsubscribeFn,
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
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import type {
  WorkspaceIdentityDescriptorResolver,
} from "./tauriWorkspaceIdentityGateway";
import { workspaceRelativePathForDescriptor } from "./tauriWorkspaceIdentityGateway";

const MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT =
  "php://managed-phpactor-install-completed";
import type { LanguageServerWorkspaceEdit } from "../domain/languageServerFeatures";

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
    _query: string,
    _replacement: string,
    _options?: TextSearchOptions,
    _scopePath?: string,
  ): Promise<ReplaceInPathResult> {
    this.trustedTarget(root);
    throw new Error(
      "Replace in Path is unavailable because this backend does not yet provide descriptor-scoped replacement.",
    );
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

function joinWorkspacePath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}
