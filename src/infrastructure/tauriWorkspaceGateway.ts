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
} from "../domain/workspace";

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
    return invoke<void>("create_directory", { path });
  }

  createTextFile(path: string): Promise<void> {
    return invoke<void>("create_text_file", { path });
  }

  deletePath(path: string): Promise<void> {
    return invoke<void>("delete_path", { path });
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
    return invoke<FileEntry[]>("read_directory", { path });
  }

  readTextFile(path: string): Promise<string> {
    return invoke<string>("read_text_file", { path });
  }

  renamePath(from: string, to: string): Promise<void> {
    return invoke<void>("rename_path", { from, to });
  }

  searchFiles(
    root: string,
    query: string,
    limit: number,
  ): Promise<FileSearchResult[]> {
    return invoke<FileSearchResult[]>("search_files", { root, query, limit });
  }

  searchText(
    root: string,
    query: string,
    limit: number,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]> {
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
    return invoke<ReplaceInPathResult>("replace_in_path", {
      root,
      query,
      replacement,
      options: options ?? null,
      scopePath: scopePath ?? null,
    });
  }

  writeTextFile(path: string, content: string): Promise<void> {
    return invoke<void>("write_text_file", { path, content });
  }
}
