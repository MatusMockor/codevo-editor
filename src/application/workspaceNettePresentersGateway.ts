import {
  isNettePresenterDiscoverySourcePath,
  scanNettePresenterLinkTargets,
  type NettePresenterLinkCapabilities,
} from "./nettePresenterLinkDiscovery";
import {
  isLatteScanSkippedDirectory,
  listLatteTemplateRelativePaths,
  type LatteTemplateCache,
} from "./netteTemplateDiscovery";
import {
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
} from "./latteProviderFlowContext";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  projectNetteWorkspacePresenters,
  type NetteWorkspacePresenterOverlay,
  type NetteWorkspacePresenterProjectionOptions,
  type NetteWorkspacePresenterSourceEntry,
  type NetteWorkspacePresentersResult,
} from "../domain/netteWorkspacePresenters";
import type { NetteWorkspacePresentersGateway } from "../domain/netteWorkspacePresentersGateway";
import {
  joinWorkspacePath,
  workspaceRelativePath,
  type WorkspaceFileGateway,
} from "../domain/workspace";

const NETTE_MAX_DIRECTORIES = 2_000;
const NETTE_MAX_DIRECTORY_ENTRIES = 20_000;
const NETTE_MAX_SOURCE_BYTES = 512 * 1_024;
const NETTE_MAX_TOTAL_SOURCE_BYTES = 8 * 1_024 * 1_024;
const LIMIT_MESSAGE = "Nette presenter inspection exceeded its safety limits.";

export interface WorkspaceNettePresentersGatewayOptions extends NetteWorkspacePresenterProjectionOptions {
  readonly maxDepth?: number;
  readonly maxTemplates?: number;
}

export class WorkspaceNettePresentersGateway implements NetteWorkspacePresentersGateway {
  constructor(
    private readonly workspaceFiles: Pick<
      WorkspaceFileGateway,
      "readDirectoryBounded" | "readTextFileBounded"
    > & {
      readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
      readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
    },
    private readonly options: WorkspaceNettePresentersGatewayOptions = {},
  ) {}

  async inspectNetteWorkspacePresenters(
    rootPath: string,
    overlays: readonly NetteWorkspacePresenterOverlay[],
  ): Promise<NetteWorkspacePresentersResult> {
    if (!rootPath.trim()) {
      return { status: "unavailable", message: "No workspace is open." };
    }

    try {
      const presenterSources: NetteWorkspacePresenterSourceEntry[] = [];
      const boundedReader = presenterOverlayReader(rootPath, this.workspaceFiles, overlays);
      const reader = boundedReader.reader;
      const maxPresenters = boundedOption(this.options.maxPresenters, MAX_LATTE_TEMPLATE_FILES);
      const maxTemplates = boundedOption(this.options.maxTemplates, MAX_LATTE_TEMPLATE_FILES);
      const maxDepth = boundedOption(this.options.maxDepth, MAX_LATTE_SCAN_DEPTH);
      let discoveredPresenterCandidates = 0;
      const capabilities: NettePresenterLinkCapabilities = {
        isPresenterSourcePath: (path) => {
          const eligible = isNettePresenterDiscoverySourcePath(path);
          if (eligible) discoveredPresenterCandidates += 1;
          return eligible;
        },
        parsePresenterLinkTarget: parseNetteLinkTarget,
        presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
        presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
        presenterLinkTargetsFromSource: (path, source) => {
          if (path.endsWith("Presenter.php")) {
            presenterSources.push({ path, source });
          }
          return [];
        },
        presenterScanDirectories: ["app"],
      };
      const templateCache: LatteTemplateCache = {};

      const [, templateRelativePaths] = await Promise.all([
        scanNettePresenterLinkTargets({
          cache: {},
          currentRelativePath: "",
          deps: {
            getActiveDocument: () => null,
            joinPath: joinWorkspacePath,
            listDirectory: (path) => reader.readDirectory(path),
            openTarget: async () => false,
            readFileContent: (path) => reader.readTextFile(path),
            toRelativePath: relativePathOrEmpty,
          },
          frameworkCapabilities: capabilities,
          inFlight: new Map(),
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive: () => true,
          maxDepth,
          maxPresenters,
          requestedRoot: rootPath,
          ttlMs: 0,
        }),
        listLatteTemplateRelativePaths({
          cache: templateCache,
          deps: {
            joinPath: joinWorkspacePath,
            listDirectory: (path) => reader.readDirectory(path),
            toRelativePath: relativePathOrEmpty,
          },
          isRequestedRootActive: () => true,
          maxDepth,
          maxTemplates,
          requestedRoot: rootPath,
          scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
          ttlMs: 0,
        }),
      ]);
      const result = projectNetteWorkspacePresenters(
        rootPath,
        presenterSources,
        templateRelativePaths,
        overlays,
        this.options,
      );

      if (boundedReader.limitsExceeded()) {
        return { status: "error", message: LIMIT_MESSAGE };
      }
      if (result.status !== "ok") return result;
      const templatesComplete = templateCache[rootPath]?.complete === true;
      return {
        ...result,
        truncated:
          result.truncated || discoveredPresenterCandidates >= maxPresenters || !templatesComplete,
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function presenterOverlayReader(
  rootPath: string,
  workspaceFiles: {
    readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
    readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
  },
  overlays: readonly NetteWorkspacePresenterOverlay[],
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
    const relativePath = safeWorkspaceRelativePath(rootPath, overlay.path);
    if (relativePath !== null) sourcesByRelativePath.set(relativePath, overlay.source);
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
        if (safeWorkspaceRelativePath(rootPath, path) === null) {
          throw new Error("Presenter discovery left the workspace root.");
        }
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
        directoryEntryCount += result.entries.length;
        if (directoryEntryCount > NETTE_MAX_DIRECTORY_ENTRIES) {
          exceeded = true;
          throw new Error(LIMIT_MESSAGE);
        }
        return [...result.entries];
      },
      readTextFile: async (path) => {
        if (exceeded) throw new Error(LIMIT_MESSAGE);
        const relativePath = safeWorkspaceRelativePath(rootPath, path);
        if (relativePath === null) {
          throw new Error("Presenter discovery left the workspace root.");
        }
        const overlay = sourcesByRelativePath.get(relativePath);
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

function relativePathOrEmpty(rootPath: string, path: string): string {
  return safeWorkspaceRelativePath(rootPath, path) ?? "";
}

function safeWorkspaceRelativePath(rootPath: string, path: string): string | null {
  const relativePath = workspaceRelativePath(rootPath, path);
  return relativePath !== null &&
    relativePath
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    ? relativePath
    : null;
}

function boundedOption(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}
