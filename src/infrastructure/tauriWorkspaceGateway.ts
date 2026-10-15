import { invoke } from "@tauri-apps/api/core";
import type {
  FileEntry,
  FileSearchGateway,
  FileSearchResponse,
  FileSearchResult,
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
  WorkspaceWriteResult,
  WorkspaceMutationResult,
} from "../domain/workspace";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import { workspaceRelativePathForDescriptor } from "./tauriWorkspaceIdentityGateway";
import { invokeCreateWorkspaceTextWithContent } from "./tauriWorkspaceMutationIpcContract";
import { invokeWorkspaceDirectoryIpc } from "./tauriWorkspaceDirectoryIpcContract";

const MAX_WORKSPACE_RELATIVE_WRITE_PATH_BYTES = 4_096;
const MAX_DESCRIPTOR_FILE_SEARCH_RESULTS = 500;
const MAX_DESCRIPTOR_FILE_SEARCH_NAME_BYTES = 255;
const MAX_DESCRIPTOR_FILE_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const DESCRIPTOR_FILE_SEARCH_ENVELOPE_RESERVE_BYTES = 512;

type TauriWorkspaceFileReader = Pick<
  WorkspaceFileGateway,
  "readDirectory" | "readDirectoryBounded"
>;

type TauriWorkspaceOwnerFileWriter = Pick<
  WorkspaceOwnerFileGateway,
  "createDirectoryForWorkspace" | "createTextFileWithContentForWorkspace"
>;

export class TauriWorkspaceGateway
  implements FileSearchGateway, TauriWorkspaceFileReader, TauriWorkspaceOwnerFileWriter
{
  constructor(private readonly workspaceIdentities?: WorkspaceIdentityDescriptorResolver) {}

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
        ignored: entry.ignored,
      })),
      truncated: result.truncated,
    }));
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
        .then((payload) => parseDescriptorFileSearchResponse(payload, root, limit))
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
    const matchForPath = this.workspaceIdentities?.matchForPath;
    if (matchForPath) {
      const match = matchForPath.call(this.workspaceIdentities, path, workspaceId);
      return match
        ? {
            workspaceId: match.descriptor.workspaceId,
            relativePath: match.relativePath,
          }
        : null;
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

function parseDescriptorFileSearchResponse(
  payload: unknown,
  root: string,
  requestedLimit: number,
): FileSearchResponse {
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

  const boundedLimit = Math.min(
    MAX_DESCRIPTOR_FILE_SEARCH_RESULTS,
    Math.max(1, Number.isSafeInteger(requestedLimit) ? requestedLimit : 1),
  );
  if (record.results.length > boundedLimit) {
    throw new Error("File search returned too many results.");
  }

  let responseBytes = DESCRIPTOR_FILE_SEARCH_ENVELOPE_RESERVE_BYTES;
  const results = record.results.map((value) => {
    const result = parseDescriptorFileSearchResult(value, root);
    responseBytes += new TextEncoder().encode(JSON.stringify(value)).byteLength + 1;
    if (responseBytes > MAX_DESCRIPTOR_FILE_SEARCH_RESPONSE_BYTES) {
      throw new Error("File search response exceeded its byte limit.");
    }
    return result;
  });

  return {
    requestGeneration: record.requestGeneration,
    results,
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
    keys.length !== 2 ||
    keys[0] !== "name" ||
    keys[1] !== "relativePath" ||
    typeof record.name !== "string" ||
    record.name.length === 0 ||
    typeof record.relativePath !== "string" ||
    record.relativePath.length === 0
  ) {
    throw new Error("File search returned an invalid result.");
  }
  if (!isNormalizedWorkspaceRelativePath(record.relativePath)) {
    throw new Error("File search returned an invalid result path.");
  }
  if (new TextEncoder().encode(record.name).byteLength > MAX_DESCRIPTOR_FILE_SEARCH_NAME_BYTES) {
    throw new Error("File search returned an oversized result name.");
  }
  const segments = record.relativePath.split("/");
  if (record.name !== segments[segments.length - 1]) {
    throw new Error("File search returned an inconsistent result name.");
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

function isValidSearchRequestGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function isNormalizedWorkspaceRelativePath(relativePath: string): boolean {
  return !(
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
  );
}

type TrustedWorkspaceTarget = Record<string, unknown> & {
  workspaceId: string;
  relativePath: string;
};
type DescriptorFileEntry = Omit<FileEntry, "path"> & { relativePath: string };
function joinWorkspacePath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot;
}
