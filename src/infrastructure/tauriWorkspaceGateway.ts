import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FileEntry,
  FileSearchGateway,
  FileSearchResponse,
  FileSearchResult,
  ManagedPhpactorInstallCompletionEvent,
  ManagedPhpactorInstallUnsubscribeFn,
  ManagedTypeScriptInstallCompletionEvent,
  PhpToolGateway,
  PhpToolAvailability,
  ReplaceInPathResult,
  TextSearchGateway,
  TextSearchOptions,
  TextSearchResponse,
  TextSearchResult,
  WorkspaceDescriptor,
  WorkspaceDetectionGateway,
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
  WorkspaceOwnerRelativeFileGateway,
  WorkspaceWriteResult,
  WorkspaceFileRevision,
  WorkspaceMutationResult,
  WorkspaceImageFile,
  WorkspaceTextFileSnapshot,
  WorkspaceEditTransaction,
} from "../domain/workspace";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import { workspaceRelativePathForDescriptor } from "./tauriWorkspaceIdentityGateway";
import { invokeCreateWorkspaceTextWithContent } from "./tauriWorkspaceMutationIpcContract";
import {
  invokeWorkspaceTestDiscoveryIpc,
  WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS,
} from "./tauriWorkspaceTestDiscoveryIpcContract";
import { invokeWorkspaceDirectoryIpc } from "./tauriWorkspaceDirectoryIpcContract";

const MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT = "php://managed-phpactor-install-completed";
const MANAGED_TYPESCRIPT_INSTALL_COMPLETED_EVENT =
  "typescript://managed-language-server-install-completed";
const MAX_WORKSPACE_RELATIVE_WRITE_PATH_BYTES = 4_096;
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
    WorkspaceFileGateway,
    WorkspaceOwnerFileGateway,
    WorkspaceOwnerRelativeFileGateway
{
  constructor(private readonly workspaceIdentities?: WorkspaceIdentityDescriptorResolver) {}

  applyWorkspaceEdit(
    rootPath: string,
    edit: LanguageServerWorkspaceEdit,
    skippedPaths: string[],
  ): Promise<number> {
    const target = this.optionalTrustedTarget(rootPath);
    if (target) {
      return invoke<WorkspaceEditResult>("workspace_apply_workspace_edit", {
        workspaceId: target.workspaceId,
        edit: relativeWorkspaceEdit(
          edit,
          (path) => this.optionalTrustedTarget(path, target.workspaceId)?.relativePath ?? null,
        ),
        skippedPaths: skippedPaths.flatMap((path) => {
          const relativePath = this.optionalTrustedTarget(path, target.workspaceId)?.relativePath;
          return relativePath === undefined ? [] : [relativePath];
        }),
      }).then(workspaceEditCount);
    }

    return invoke<number>("apply_workspace_edit", {
      edit,
      rootPath,
      skippedPaths,
    });
  }

  async applyWorkspaceEditTransaction(
    rootPath: string,
    edit: LanguageServerWorkspaceEdit,
    skippedPaths: string[],
    expectedStates: Readonly<Record<string, string | null>> = {},
  ): Promise<WorkspaceEditTransaction> {
    const target = this.trustedTarget(rootPath);
    const relativeEdit = relativeWorkspaceEdit(
      edit,
      (path) => this.optionalTrustedTarget(path, target.workspaceId)?.relativePath ?? null,
    );
    const relativeSkippedPaths = skippedPaths.flatMap((path) => {
      const relativePath = this.optionalTrustedTarget(path, target.workspaceId)?.relativePath;
      return relativePath === undefined ? [] : [relativePath];
    });
    const relativeExpectedStates = Object.fromEntries(
      Object.entries(expectedStates).map(([path, hash]) => {
        const relativePath = this.optionalTrustedTarget(path, target.workspaceId)?.relativePath;
        if (relativePath === undefined) {
          throw new Error("A workspace edit precondition is outside the captured workspace.");
        }
        return [relativePath, hash];
      }),
    );
    const result = await invoke<TransactionalWorkspaceEditResult>(
      "workspace_apply_workspace_edit_transaction",
      {
        workspaceId: target.workspaceId,
        edit: relativeEdit,
        skippedPaths: relativeSkippedPaths,
        expectedStates: relativeExpectedStates,
        fileModes: {},
      },
    );
    let rolledBack = false;
    return {
      appliedCount: result.appliedCount,
      rollback: async () => {
        if (rolledBack || result.appliedCount === 0) {
          return;
        }
        await invoke<TransactionalWorkspaceEditResult>(
          "workspace_apply_workspace_edit_transaction",
          {
            workspaceId: target.workspaceId,
            edit: result.rollbackEdit,
            skippedPaths: [],
            expectedStates: result.rollbackExpectedStates,
            fileModes: result.rollbackFileModes,
          },
        );
        rolledBack = true;
      },
    };
  }

  createDirectory(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_create_directory", target).then(
      assertMutationSucceeded,
    );
  }

  createDirectoryForWorkspace(workspaceId: string, path: string): Promise<void> {
    const target = this.ownerTarget(workspaceId, path);
    return invoke<WorkspaceMutationResult>("workspace_create_directory", target).then(
      assertMutationSucceeded,
    );
  }

  createTextFileWithContentForWorkspace(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<WorkspaceWriteResult> {
    return invokeCreateWorkspaceTextWithContent(invoke, {
      ...this.ownerTarget(workspaceId, path),
      content,
    });
  }

  createTextFile(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_create_text_file", target).then(
      assertMutationSucceeded,
    );
  }

  deletePath(path: string): Promise<void> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceMutationResult>("workspace_delete_path", target).then(
      assertMutationSucceeded,
    );
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
        entries.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          path: joinWorkspacePath(path, entry.relativePath),
        })),
      );
    }

    return invoke<FileEntry[]>("read_directory", { path });
  }

  readDirectoryBounded(path: string, maxEntries: number) {
    const target = this.trustedTarget(path);
    return invokeWorkspaceDirectoryIpc(invoke, { ...target, maxEntries }).then((result) => ({
      entries: result.entries.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        path: joinWorkspacePath(path, entry.relativePath),
      })),
      truncated: result.truncated,
    }));
  }

  async readImageFile(path: string): Promise<WorkspaceImageFile> {
    const target = this.trustedTarget(path);
    return invoke<WorkspaceImageFile>("workspace_read_image_file", target);
  }

  readTextFile(path: string): Promise<string> {
    return this.readTextFileSnapshot(path).then((snapshot) => snapshot.content);
  }

  readTextFileBounded(path: string, maxBytes: number) {
    const target = this.trustedTarget(path);
    return invokeWorkspaceTestDiscoveryIpc(
      invoke,
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.readBounded,
      { ...target, maxBytes },
    );
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

  searchFiles(root: string, query: string, limit: number): Promise<FileSearchResult[]> {
    return this.searchFilesWithMetadata(root, query, limit, "gateway-file-search").then(
      (response) => [...response.results],
    );
  }

  searchFilesWithMetadata(
    root: string,
    query: string,
    limit: number,
    requestGeneration = "gateway-file-search",
  ): Promise<FileSearchResponse> {
    if (!isValidSearchRequestGeneration(requestGeneration)) {
      return Promise.reject(new Error("File search request generation is invalid."));
    }
    const target = this.optionalTrustedTarget(root);
    if (target) {
      return invoke<unknown>("workspace_search_files", {
        ...target,
        query,
        limit,
        requestGeneration,
      })
        .then((payload) => parseDescriptorFileSearchResponse(payload, root))
        .then((response) => {
          if (response.requestGeneration !== requestGeneration) {
            throw new Error("File search returned a mismatched request generation.");
          }
          return response;
        });
    }

    return invoke<unknown>("search_files", { root, query, limit }).then((payload) =>
      parseLegacyFileSearchPayload(payload, requestGeneration),
    );
  }

  searchText(
    root: string,
    query: string,
    limit: number,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]> {
    return this.searchTextWithMetadata(root, query, limit, options, "gateway-search-text").then(
      (response) => [...response.results],
    );
  }

  searchTextWithMetadata(
    root: string,
    query: string,
    limit: number,
    options?: TextSearchOptions,
    requestGeneration = "gateway-search-text",
  ): Promise<TextSearchResponse> {
    if (!isValidSearchRequestGeneration(requestGeneration)) {
      return Promise.reject(new Error("Text search request generation is invalid."));
    }
    const target = this.optionalTrustedTarget(root);
    if (target) {
      return invoke<unknown>("workspace_search_text", {
        ...target,
        query,
        limit,
        options: options ?? null,
        requestGeneration,
      })
        .then((payload) => parseDescriptorTextSearchResponse(payload, root))
        .then((response) => {
          if (response.requestGeneration !== requestGeneration) {
            throw new Error("Text search returned a mismatched request generation.");
          }
          return response;
        });
    }

    return invoke<unknown>("search_text", {
      root,
      query,
      limit,
      options: options ?? null,
    }).then((payload) => ({
      requestGeneration,
      results: parseLegacyTextSearchResults(payload),
      truncated: false,
    }));
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

  writeTextFileForWorkspace(
    workspaceId: string,
    path: string,
    content: string,
    expectedRevision: WorkspaceFileRevision,
  ): Promise<WorkspaceWriteResult> {
    const target = this.optionalTrustedTarget(path, workspaceId);
    if (!target) {
      throw new Error("The requested file does not belong to the captured workspace.");
    }

    return invoke<WorkspaceWriteResult>("workspace_save_text_file", {
      ...target,
      content,
      expectedRevision,
    });
  }

  writeTextFileForWorkspaceRelativePath(
    workspaceId: string,
    relativePath: string,
    content: string,
    expectedRevision: WorkspaceFileRevision,
  ): Promise<WorkspaceWriteResult> {
    assertNormalizedWorkspaceRelativeWritePath(relativePath);
    return invoke<WorkspaceWriteResult>("workspace_save_text_file", {
      workspaceId,
      relativePath,
      content,
      expectedRevision,
    });
  }

  private ownerTarget(workspaceId: string, path: string): TrustedWorkspaceTarget {
    const target = this.optionalTrustedTarget(path, workspaceId);
    if (!target) {
      throw new Error("The requested file does not belong to the captured workspace.");
    }
    return target;
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

  private optionalTrustedTarget(path: string, workspaceId?: string): TrustedWorkspaceTarget | null {
    const match = this.workspaceIdentities?.matchForPath?.(path, workspaceId);
    if (match) {
      return {
        workspaceId: match.descriptor.workspaceId,
        relativePath: match.relativePath,
      };
    }

    const descriptor = this.workspaceIdentities?.descriptorForPath(path) ?? null;
    if (!descriptor) {
      return null;
    }

    if (workspaceId && descriptor.workspaceId !== workspaceId) {
      return null;
    }

    const relativePath = workspaceRelativePathForDescriptor(descriptor, path);
    if (relativePath === null) {
      if (workspaceId) {
        return null;
      }

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

function assertNormalizedWorkspaceRelativeWritePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:/.test(relativePath) ||
    /\p{Cc}/u.test(relativePath) ||
    relativePath
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..") ||
    new TextEncoder().encode(relativePath).byteLength > MAX_WORKSPACE_RELATIVE_WRITE_PATH_BYTES
  ) {
    throw new TypeError(
      `Workspace-relative write path must be a normalized descendant path of at most ${MAX_WORKSPACE_RELATIVE_WRITE_PATH_BYTES} UTF-8 bytes.`,
    );
  }
}

function parseDescriptorFileSearchResponse(payload: unknown, root: string): FileSearchResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("File search returned an invalid payload.");
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "requestGeneration" ||
    keys[1] !== "results" ||
    keys[2] !== "truncated" ||
    !isValidSearchRequestGeneration(record.requestGeneration) ||
    !Array.isArray(record.results) ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("File search returned an invalid payload.");
  }

  return {
    requestGeneration: record.requestGeneration,
    results: record.results.map((value) => parseDescriptorFileSearchResult(value, root)),
    truncated: record.truncated,
  };
}

function parseDescriptorFileSearchResult(value: unknown, root: string): FileSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File search returned an invalid result.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "name" ||
    keys[1] !== "relativePath" ||
    keys[2] !== "truncated" ||
    typeof record.name !== "string" ||
    record.name.length === 0 ||
    typeof record.relativePath !== "string" ||
    record.relativePath.length === 0 ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("File search returned an invalid result.");
  }
  return {
    name: record.name,
    path: joinWorkspacePath(root, record.relativePath),
    relativePath: record.relativePath,
  };
}

function parseLegacyFileSearchPayload(
  payload: unknown,
  requestGeneration: string,
): FileSearchResponse {
  if (!Array.isArray(payload)) {
    throw new Error("File search returned an invalid payload.");
  }

  let truncated = false;
  const results = payload.flatMap((value): FileSearchResult[] => {
    const result = parseLegacyFileSearchResult(value);
    truncated ||= result.truncated;
    return result.result ? [result.result] : [];
  });

  return { requestGeneration, results, truncated };
}

function parseLegacyFileSearchResult(value: unknown): {
  readonly result: FileSearchResult | null;
  readonly truncated: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File search returned an invalid result.");
  }

  const record = value as Record<string, unknown>;
  const expectedKeys = ["name", "path", "relativePath", "truncated"];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("File search returned an invalid result.");
  }

  if (
    typeof record.name !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("File search returned an invalid result.");
  }

  if (typeof record.path !== "string") {
    throw new Error("File search returned an invalid result.");
  }

  if (record.relativePath === "") {
    if (record.name !== "" || !record.truncated) {
      throw new Error("File search returned an invalid result.");
    }

    return { result: null, truncated: true };
  }

  return {
    result: {
      name: record.name,
      path: record.path,
      relativePath: record.relativePath,
    },
    truncated: record.truncated,
  };
}

function parseDescriptorTextSearchResponse(payload: unknown, root: string): TextSearchResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Text search returned an invalid payload.");
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "requestGeneration" ||
    keys[1] !== "results" ||
    keys[2] !== "truncated" ||
    !isValidSearchRequestGeneration(record.requestGeneration) ||
    !Array.isArray(record.results) ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("Text search returned an invalid payload.");
  }

  return {
    requestGeneration: record.requestGeneration,
    results: record.results.map((value) => parseTextSearchResult(value, root, false)),
    truncated: record.truncated,
  };
}

function parseLegacyTextSearchResults(payload: unknown): TextSearchResult[] {
  if (!Array.isArray(payload)) {
    throw new Error("Text search returned an invalid payload.");
  }

  return payload.map((value) => parseTextSearchResult(value, "", true));
}

function parseTextSearchResult(
  value: unknown,
  root: string,
  hasAbsolutePath: boolean,
): TextSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Text search returned an invalid result.");
  }

  const record = value as Record<string, unknown>;
  const expectedKeys = hasAbsolutePath
    ? ["column", "lineNumber", "lineText", "matchEnd", "matchStart", "path", "relativePath"]
    : [
        "column",
        "lineNumber",
        "lineText",
        "matchEnd",
        "matchStart",
        "matchTruncated",
        "previewTruncated",
        "relativePath",
      ];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Text search returned an invalid result.");
  }

  if (
    typeof record.relativePath !== "string" ||
    record.relativePath.length === 0 ||
    typeof record.lineNumber !== "number" ||
    !Number.isSafeInteger(record.lineNumber) ||
    record.lineNumber < 1 ||
    typeof record.column !== "number" ||
    !Number.isSafeInteger(record.column) ||
    record.column < 1 ||
    typeof record.lineText !== "string" ||
    typeof record.matchStart !== "number" ||
    !Number.isSafeInteger(record.matchStart) ||
    record.matchStart < 0 ||
    typeof record.matchEnd !== "number" ||
    !Number.isSafeInteger(record.matchEnd) ||
    record.matchEnd < record.matchStart ||
    (!hasAbsolutePath &&
      (typeof record.previewTruncated !== "boolean" ||
        typeof record.matchTruncated !== "boolean")) ||
    (hasAbsolutePath && (typeof record.path !== "string" || record.path.length === 0))
  ) {
    throw new Error("Text search returned an invalid result.");
  }
  const previewLength = Array.from(record.lineText).length;
  const previewTruncated = hasAbsolutePath ? false : (record.previewTruncated as boolean);
  const matchTruncated = hasAbsolutePath ? false : (record.matchTruncated as boolean);
  if (
    record.matchStart > previewLength ||
    (record.matchEnd > previewLength && !matchTruncated) ||
    (matchTruncated && !previewTruncated)
  ) {
    throw new Error("Text search returned an invalid result.");
  }

  return {
    path: hasAbsolutePath ? (record.path as string) : joinWorkspacePath(root, record.relativePath),
    relativePath: record.relativePath,
    lineNumber: record.lineNumber,
    column: record.column,
    lineText: record.lineText,
    matchStart: record.matchStart,
    matchEnd: record.matchEnd,
    ...(hasAbsolutePath
      ? {}
      : {
          previewTruncated: record.previewTruncated as boolean,
          matchTruncated: record.matchTruncated as boolean,
        }),
  };
}

function isValidSearchRequestGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/.test(value);
}

type TrustedWorkspaceTarget = Record<string, unknown> & {
  workspaceId: string;
  relativePath: string;
};
type DescriptorFileEntry = Omit<FileEntry, "path"> & { relativePath: string };
type DescriptorReplaceFile = Omit<ReplaceInPathResult["files"][number], "path">;
type DescriptorReplaceFailure = { relativePath: string; message: string };
type DescriptorReplaceResult =
  | { status: "success"; files: DescriptorReplaceFile[]; totalReplacements: number }
  | {
      status: "conflict";
      files: DescriptorReplaceFile[];
      totalReplacements: number;
      conflicts: DescriptorReplaceFailure[];
      message: string;
    }
  | {
      status: "partial";
      files: DescriptorReplaceFile[];
      totalReplacements: number;
      conflicts: DescriptorReplaceFailure[];
      errors: DescriptorReplaceFailure[];
      message: string;
    }
  | {
      status: "error";
      files: DescriptorReplaceFile[];
      totalReplacements: number;
      errors: DescriptorReplaceFailure[];
      message: string;
    };
type WorkspaceEditResult = {
  status: "success" | "conflict" | "partial" | "error" | "notFound";
  appliedCount: number;
  appliedFileOperations: number;
  appliedTextFiles: number;
  failedPath?: string;
  message?: string;
};
type TransactionalWorkspaceEditResult = {
  appliedCount: number;
  rollbackEdit: LanguageServerWorkspaceEdit;
  rollbackExpectedStates: Record<string, string | null>;
  rollbackFileModes: Record<string, number>;
};

function workspaceEditCount(result: WorkspaceEditResult): number {
  if (result.status === "success") return result.appliedCount;
  throw new Error(`${result.failedPath ?? "workspace edit"}: ${result.message ?? result.status}`);
}

function relativeWorkspaceEdit(
  edit: LanguageServerWorkspaceEdit,
  relativePathForPath: (path: string) => string | null,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).flatMap(([uri, edits]) => {
      const relativePath = relativePathFromUri(relativePathForPath, uri);
      return relativePath === null ? [] : [[relativePath, edits]];
    }),
  );
  const fileOperations = edit.fileOperations?.flatMap((operation) => {
    const relativeOperation = relativeFileOperation(relativePathForPath, operation);
    return relativeOperation ? [relativeOperation] : [];
  });
  const documentVersions = edit.documentVersions
    ? Object.fromEntries(
        Object.entries(edit.documentVersions).flatMap(([uri, version]) => {
          const relativePath = relativePathFromUri(relativePathForPath, uri);
          return relativePath === null ? [] : [[relativePath, version]];
        }),
      )
    : undefined;
  return { ...edit, changes, documentVersions, fileOperations };
}

function relativeFileOperation(
  relativePathForPath: (path: string) => string | null,
  operation: LanguageServerWorkspaceFileOperation,
): LanguageServerWorkspaceFileOperation | null {
  if (operation.kind !== "rename") {
    const uri = relativePathFromUri(relativePathForPath, operation.uri);
    return uri === null ? null : { ...operation, uri };
  }
  const oldUri = relativePathFromUri(relativePathForPath, operation.oldUri);
  const newUri = relativePathFromUri(relativePathForPath, operation.newUri);
  if (oldUri === null || newUri === null) return null;
  return { ...operation, oldUri, newUri };
}

function relativePathFromUri(
  relativePathForPath: (path: string) => string | null,
  uri: string,
): string | null {
  const path = pathFromLanguageServerUri(uri);
  if (path === null) return null;
  return relativePathForPath(path);
}

function mapReplaceResult(root: string, result: DescriptorReplaceResult): ReplaceInPathResult {
  const files = result.files.map((file) => ({
    ...file,
    path: joinWorkspacePath(root, file.relativePath),
  }));
  if (result.status === "success") return { ...result, files };
  const mapFailures = (items: DescriptorReplaceFailure[]) =>
    items.map((item) => ({ ...item, path: joinWorkspacePath(root, item.relativePath) }));
  if (result.status === "conflict")
    return { ...result, files, conflicts: mapFailures(result.conflicts) };
  if (result.status === "partial")
    return {
      ...result,
      files,
      conflicts: mapFailures(result.conflicts),
      errors: mapFailures(result.errors),
    };
  return { ...result, files, errors: mapFailures(result.errors) };
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}
