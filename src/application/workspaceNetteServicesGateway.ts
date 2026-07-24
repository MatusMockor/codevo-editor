import type { NetteWorkspaceServicesGateway } from "../domain/netteWorkspaceServicesGateway";
import type { NetteWorkspaceServiceOverlay } from "../domain/netteWorkspaceServicesGateway";
import {
  projectNetteWorkspaceServices,
  resolveNetteWorkspaceServiceOverlayPath,
  type NetteWorkspaceServicesProjectionOptions,
  type NetteWorkspaceServicesResult,
} from "../domain/netteWorkspaceServices";
import { workspaceRelativePath, type WorkspaceFileGateway } from "../domain/workspace";
import { loadPhpNetteNeonConfigSourceCollection } from "./phpNetteNeonSources";

const NETTE_MAX_DIRECTORIES = 2_000;
const NETTE_MAX_DIRECTORY_ENTRIES = 20_000;
const NETTE_MAX_SOURCE_BYTES = 512 * 1_024;
const NETTE_MAX_TOTAL_SOURCE_BYTES = 8 * 1_024 * 1_024;
const LIMIT_MESSAGE = "Nette workspace inspection exceeded its safety limits.";

/** Application adapter that reuses the canonical Nette NEON source loader. */
export class WorkspaceNetteServicesGateway implements NetteWorkspaceServicesGateway {
  constructor(
    private readonly workspaceFiles: Pick<
      WorkspaceFileGateway,
      "readDirectoryBounded" | "readTextFileBounded"
    > & {
      readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
      readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
    },
    private readonly options: NetteWorkspaceServicesProjectionOptions = {},
  ) {}

  async inspectNetteWorkspaceServices(
    rootPath: string,
    overlays: readonly NetteWorkspaceServiceOverlay[],
  ): Promise<NetteWorkspaceServicesResult> {
    if (!rootPath.trim()) {
      return { status: "unavailable", message: "No workspace is open." };
    }

    try {
      const boundedReader = workspaceFilesWithNetteServiceOverlays(
        rootPath,
        this.workspaceFiles,
        overlays,
      );
      const collection = await loadPhpNetteNeonConfigSourceCollection(
        rootPath,
        boundedReader.reader,
      );

      if (boundedReader.limitsExceeded()) {
        return { status: "error", message: LIMIT_MESSAGE };
      }

      return projectNetteWorkspaceServices(rootPath, collection.entries, overlays, this.options);
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function workspaceFilesWithNetteServiceOverlays(
  rootPath: string,
  workspaceFiles: {
    readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
    readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
  },
  overlays: readonly NetteWorkspaceServiceOverlay[],
): {
  readonly limitsExceeded: () => boolean;
  readonly reader: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
} {
  const sourcesByRelativePath = new Map<string, string>();
  let directoryCount = 0;
  let directoryEntryCount = 0;
  let sourceBytes = 0;
  let exceeded = false;

  for (const overlay of overlays) {
    const absolutePath = resolveNetteWorkspaceServiceOverlayPath(rootPath, overlay.path);
    if (!absolutePath) continue;
    const relativePath = workspaceRelativePath(rootPath, absolutePath);

    if (relativePath !== null) {
      sourcesByRelativePath.set(relativePath, overlay.source);
    }
  }

  const accountSource = (source: string): string => {
    const bytes = new TextEncoder().encode(source).byteLength;
    sourceBytes += bytes;
    if (bytes > NETTE_MAX_SOURCE_BYTES || sourceBytes > NETTE_MAX_TOTAL_SOURCE_BYTES) {
      exceeded = true;
      throw new Error(LIMIT_MESSAGE);
    }
    return source;
  };

  return {
    limitsExceeded: () => exceeded,
    reader: {
      readDirectory: async (path) => {
        if (exceeded) throw new Error(LIMIT_MESSAGE);
        directoryCount += 1;
        if (directoryCount > NETTE_MAX_DIRECTORIES) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        const remainingEntries = NETTE_MAX_DIRECTORY_ENTRIES - directoryEntryCount;
        if (remainingEntries <= 0) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        const result = await workspaceFiles.readDirectoryBounded(path, remainingEntries);
        if (result.truncated) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        const entries = result.entries;
        directoryEntryCount += entries.length;
        if (directoryEntryCount > NETTE_MAX_DIRECTORY_ENTRIES) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        return [...entries];
      },
      readTextFile: async (path) => {
        if (exceeded) throw new Error(LIMIT_MESSAGE);
        const relativePath = workspaceRelativePath(rootPath, path);
        const overlay = relativePath === null ? undefined : sourcesByRelativePath.get(relativePath);

        if (overlay !== undefined) return accountSource(overlay);
        const result = await workspaceFiles.readTextFileBounded(path, NETTE_MAX_SOURCE_BYTES);
        if (result.status === "tooLarge") {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        return accountSource(result.content);
      },
    },
  };
}
