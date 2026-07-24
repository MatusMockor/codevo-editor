import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";
import { MAX_LATTE_SCAN_DEPTH, MAX_LATTE_TEMPLATE_FILES } from "./latteProviderFlowContext";
import {
  projectNetteWorkspaceRoutes,
  type NetteWorkspaceRouteOverlay,
  type NetteWorkspaceRouteSourceEntry,
  type NetteWorkspaceRoutesProjectionOptions,
  type NetteWorkspaceRoutesResult,
} from "../domain/netteWorkspaceRoutes";
import type { NetteWorkspaceRoutesGateway } from "../domain/netteWorkspaceRoutesGateway";
import {
  joinWorkspacePath,
  workspaceRelativePath,
  type WorkspaceFileGateway,
} from "../domain/workspace";

const MAX_DIRECTORIES = 2_000;
const MAX_DIRECTORY_ENTRIES = 20_000;
const MAX_SOURCE_BYTES = 512 * 1_024;
const MAX_TOTAL_SOURCE_BYTES = 8 * 1_024 * 1_024;
const LIMIT_MESSAGE = "Nette route inspection exceeded its safety limits.";

export interface WorkspaceNetteRoutesGatewayOptions extends NetteWorkspaceRoutesProjectionOptions {
  readonly maxDepth?: number;
  readonly maxSourceFiles?: number;
}

export class WorkspaceNetteRoutesGateway implements NetteWorkspaceRoutesGateway {
  constructor(
    private readonly workspaceFiles: {
      readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
      readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
    },
    private readonly options: WorkspaceNetteRoutesGatewayOptions = {},
  ) {}

  async inspectNetteWorkspaceRoutes(
    rootPath: string,
    overlays: readonly NetteWorkspaceRouteOverlay[],
  ): Promise<NetteWorkspaceRoutesResult> {
    if (!rootPath.trim()) {
      return { status: "unavailable", message: "No workspace is open." };
    }

    try {
      const boundedReader = routeOverlayReader(rootPath, this.workspaceFiles, overlays);
      const maxSourceFiles = boundedOption(this.options.maxSourceFiles, MAX_LATTE_TEMPLATE_FILES);
      const discovery = await collectBoundedRouteSources(
        boundedReader.reader,
        joinWorkspacePath(rootPath, "app"),
        boundedOption(this.options.maxDepth, MAX_LATTE_SCAN_DEPTH),
        maxSourceFiles,
      );

      if (boundedReader.limitsExceeded()) {
        return { status: "error", message: LIMIT_MESSAGE };
      }
      if (boundedReader.readFailed()) {
        return { status: "error", message: "Could not read the complete Nette route source set." };
      }
      const result = projectNetteWorkspaceRoutes(
        rootPath,
        discovery.sources,
        overlays,
        this.options,
      );
      return result.status === "ok"
        ? {
            ...result,
            truncated: result.truncated || discovery.truncated,
          }
        : result;
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

async function collectBoundedRouteSources(
  reader: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">,
  appDirectory: string,
  maxDepth: number,
  maxSourceFiles: number,
): Promise<{
  readonly sources: readonly NetteWorkspaceRouteSourceEntry[];
  readonly truncated: boolean;
}> {
  const paths: string[] = [];
  let truncated = false;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (paths.length >= maxSourceFiles) {
      truncated = true;
      return;
    }
    let entries: Awaited<ReturnType<typeof reader.readDirectory>>;
    try {
      entries = await reader.readDirectory(directory);
    } catch {
      return;
    }
    for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
      if (entry.kind === "directory") {
        if (isLatteScanSkippedDirectory(entry.path)) continue;
        if (depth >= maxDepth) {
          truncated = true;
          continue;
        }
        await visit(entry.path, depth + 1);
        continue;
      }
      if (!entry.path.toLowerCase().endsWith(".php")) continue;
      if (paths.length >= maxSourceFiles) {
        truncated = true;
        break;
      }
      paths.push(entry.path);
    }
  };
  await visit(appDirectory, 0);
  const sources: NetteWorkspaceRouteSourceEntry[] = [];
  for (const path of paths) {
    try {
      sources.push({ path, source: await reader.readTextFile(path) });
    } catch {
      continue;
    }
  }
  return { sources, truncated };
}

function routeOverlayReader(
  rootPath: string,
  workspaceFiles: {
    readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
    readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
  },
  overlays: readonly NetteWorkspaceRouteOverlay[],
): {
  readonly limitsExceeded: () => boolean;
  readonly readFailed: () => boolean;
  readonly reader: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
} {
  const overlayByRelativePath = new Map<string, string>();
  let directories = 0;
  let entries = 0;
  let sourceBytes = 0;
  let exceeded = false;
  let failed = false;
  for (const overlay of overlays) {
    const relative = resolveOverlayRelativePath(rootPath, overlay.path);
    if (relative !== null) overlayByRelativePath.set(relative, overlay.source);
  }
  const accountSource = (source: string): string => {
    const bytes = new TextEncoder().encode(source).byteLength;
    sourceBytes += bytes;
    if (bytes > MAX_SOURCE_BYTES || sourceBytes > MAX_TOTAL_SOURCE_BYTES) {
      exceeded = true;
      throw new Error(LIMIT_MESSAGE);
    }
    return source;
  };
  return {
    limitsExceeded: () => exceeded,
    readFailed: () => failed,
    reader: {
      readDirectory: async (path) => {
        if (exceeded) throw new Error(LIMIT_MESSAGE);
        if (safeWorkspaceRelativePath(rootPath, path) === null) {
          failed = true;
          throw new Error("Route discovery left the workspace root.");
        }
        directories += 1;
        if (directories > MAX_DIRECTORIES) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        const remaining = MAX_DIRECTORY_ENTRIES - entries;
        if (remaining <= 0) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        let result: Awaited<ReturnType<typeof workspaceFiles.readDirectoryBounded>>;
        try {
          result = await workspaceFiles.readDirectoryBounded(path, remaining);
        } catch (error) {
          failed = true;
          throw error;
        }
        if (result.truncated) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        entries += result.entries.length;
        if (entries > MAX_DIRECTORY_ENTRIES) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        return [...result.entries];
      },
      readTextFile: async (path) => {
        if (exceeded) throw new Error(LIMIT_MESSAGE);
        const relative = safeWorkspaceRelativePath(rootPath, path);
        if (relative === null) {
          failed = true;
          throw new Error("Route discovery left the workspace root.");
        }
        const overlay = overlayByRelativePath.get(relative);
        if (overlay !== undefined) return accountSource(overlay);
        let result: Awaited<ReturnType<typeof workspaceFiles.readTextFileBounded>>;
        try {
          result = await workspaceFiles.readTextFileBounded(path, MAX_SOURCE_BYTES);
        } catch (error) {
          failed = true;
          throw error;
        }
        if (result.status === "tooLarge") {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        return accountSource(result.content);
      },
    },
  };
}

function resolveOverlayRelativePath(rootPath: string, path: string): string | null {
  const absolute = safeWorkspaceRelativePath(rootPath, path);
  if (absolute !== null) return absolute;
  const normalized = path.split("\\").join("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  if (!safeRelativePath(normalized)) return null;
  return normalized;
}

function safeWorkspaceRelativePath(rootPath: string, path: string): string | null {
  const relative = workspaceRelativePath(rootPath, path);
  return relative !== null && safeRelativePath(relative) ? relative : null;
}

function safeRelativePath(path: string): boolean {
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function boundedOption(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}
