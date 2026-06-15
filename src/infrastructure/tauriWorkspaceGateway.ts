import { invoke } from "@tauri-apps/api/core";
import type {
  FileEntry,
  FileSearchResult,
  WorkspaceDescriptor,
  WorkspaceGateway,
} from "../domain/workspace";

export class TauriWorkspaceGateway implements WorkspaceGateway {
  createDirectory(path: string): Promise<void> {
    return invoke<void>("create_directory", { path });
  }

  createTextFile(path: string): Promise<void> {
    return invoke<void>("create_text_file", { path });
  }

  deletePath(path: string): Promise<void> {
    return invoke<void>("delete_path", { path });
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

  writeTextFile(path: string, content: string): Promise<void> {
    return invoke<void>("write_text_file", { path, content });
  }
}
