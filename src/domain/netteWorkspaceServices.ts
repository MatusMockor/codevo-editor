import {
  neonServiceAliasesFromSource,
  neonServicesFromSource,
  type NeonService,
} from "./netteDiContainer";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

const MAX_SERVICES = 20_000;

export interface NetteWorkspaceServiceSourceEntry {
  readonly path: string;
  readonly source: string;
}

/** An unsaved NEON document that replaces its on-disk source for inspection. */
export interface NetteWorkspaceServiceOverlay {
  readonly path: string;
  readonly source: string;
}

export interface NetteWorkspaceServiceSource {
  readonly path: string;
  readonly lineNumber: number;
  readonly column: number;
}

export interface NetteWorkspaceService {
  readonly key: string;
  readonly id: string;
  readonly className: string | null;
  readonly alias: string | null;
  readonly autowired: boolean | readonly string[];
  readonly source: NetteWorkspaceServiceSource;
}

export type NetteWorkspaceServicesResult =
  | {
      readonly status: "ok";
      readonly services: readonly NetteWorkspaceService[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export interface NetteWorkspaceServicesProjectionOptions {
  readonly maxServices?: number;
}

interface ServiceCandidate {
  readonly id: string;
  readonly alias: string | null;
  readonly service: NeonService;
  readonly source: NetteWorkspaceServiceSource;
}

/**
 * Projects already discovered NEON sources into one effective DI service list.
 * Sources must be supplied in Nette merge precedence (highest precedence first).
 * This function is pure and never reads the filesystem.
 */
export function projectNetteWorkspaceServices(
  rootPath: string,
  sourceEntries: readonly NetteWorkspaceServiceSourceEntry[],
  overlays: readonly NetteWorkspaceServiceOverlay[] = [],
  options: NetteWorkspaceServicesProjectionOptions = {},
): NetteWorkspaceServicesResult {
  if (!rootPath.trim()) {
    return { status: "unavailable", message: "No workspace is open." };
  }

  try {
    const entries = applyNetteWorkspaceServiceOverlays(rootPath, sourceEntries, overlays);
    const candidates = collectEffectiveServiceCandidates(entries);
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const maxServices = normalizedServiceCap(options.maxServices);
    const services = candidates.slice(0, maxServices).map((candidate) => {
      const resolved = resolveCandidate(candidate, candidatesById);

      return {
        key: `nette-service:${candidate.id}`,
        id: candidate.id,
        className: resolved?.className ?? resolvableClassName(candidate.service),
        alias: candidate.alias,
        autowired: resolved?.service.autowired ?? candidate.service.autowired,
        source: candidate.source,
      } satisfies NetteWorkspaceService;
    });

    return {
      status: "ok",
      services,
      total: candidates.length,
      truncated: candidates.length > services.length,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function applyNetteWorkspaceServiceOverlays(
  rootPath: string,
  entries: readonly NetteWorkspaceServiceSourceEntry[],
  overlays: readonly NetteWorkspaceServiceOverlay[],
): NetteWorkspaceServiceSourceEntry[] {
  const validEntries = entries.flatMap((entry) => {
    const relativePath = workspaceRelativePath(rootPath, entry.path);
    return relativePath === null ? [] : [{ entry, relativePath }];
  });
  const entryRelativePaths = new Set(validEntries.map(({ relativePath }) => relativePath));
  const overlaysByRelativePath = new Map<string, string>();

  for (const overlay of overlays) {
    const path = resolveNetteWorkspaceServiceOverlayPath(rootPath, overlay.path);
    const relativePath = path ? workspaceRelativePath(rootPath, path) : null;

    // Overlays replace discovered files. They never expand the crawler's scope.
    if (relativePath !== null && entryRelativePaths.has(relativePath)) {
      overlaysByRelativePath.set(relativePath, overlay.source);
    }
  }

  return validEntries.map(({ entry, relativePath }) => ({
    path: entry.path,
    source: overlaysByRelativePath.get(relativePath) ?? entry.source,
  }));
}

export function resolveNetteWorkspaceServiceOverlayPath(
  rootPath: string,
  path: string,
): string | null {
  const normalizedPath = path.split("\\").join("/").replace(/\/+$/, "");
  if (normalizedPath.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  if (workspaceRelativePath(rootPath, normalizedPath) !== null) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPath)) {
    return null;
  }

  const absolutePath = joinWorkspacePath(rootPath, normalizedPath);
  return workspaceRelativePath(rootPath, absolutePath) === null ? null : absolutePath;
}

function collectEffectiveServiceCandidates(
  entries: readonly NetteWorkspaceServiceSourceEntry[],
): ServiceCandidate[] {
  const candidates: ServiceCandidate[] = [];
  const claimedIds = new Set<string>();
  let generatedServiceIndex = 1;

  for (const entry of entries) {
    const lineStarts = computeLineStartOffsets(entry.source);
    const aliases = new Map(
      neonServiceAliasesFromSource(entry.source).map((alias) => [
        alias.serviceName,
        alias.targetName,
      ]),
    );

    for (const service of neonServicesFromSource(entry.source)) {
      let id = service.serviceName;

      if (id === null) {
        do {
          id = `0${generatedServiceIndex++}`;
        } while (claimedIds.has(id));
      }

      if (claimedIds.has(id)) {
        continue;
      }

      claimedIds.add(id);
      const position = lineColumnAt(lineStarts, service.offset);
      candidates.push({
        id,
        alias: service.serviceName ? (aliases.get(service.serviceName) ?? null) : null,
        service,
        source: { path: entry.path, ...position },
      });
    }
  }

  return candidates;
}

function resolveCandidate(
  candidate: ServiceCandidate,
  candidatesById: ReadonlyMap<string, ServiceCandidate>,
): { readonly className: string | null; readonly service: NeonService } | null {
  let current = candidate;
  const seen = new Set<string>();

  for (let depth = 0; depth < 64; depth += 1) {
    const className = resolvableClassName(current.service);

    if (className) {
      return { className, service: current.service };
    }

    const target = current.alias;

    if (!target) {
      return { className: null, service: current.service };
    }

    if (target.includes("\\")) {
      return {
        className: normalizeClassName(target),
        service: current.service,
      };
    }

    if (seen.has(current.id)) {
      return null;
    }

    seen.add(current.id);
    const next = candidatesById.get(target);

    if (!next) {
      return null;
    }

    current = next;
  }

  return null;
}

function resolvableClassName(service: NeonService): string | null {
  if (service.className) {
    return normalizeClassName(service.className);
  }

  const factoryClass = service.factory?.split("::")[0]?.trim() ?? "";
  return factoryClass && !factoryClass.startsWith("@") ? normalizeClassName(factoryClass) : null;
}

function normalizeClassName(className: string): string {
  return className.replace(/^\\+/, "");
}

function normalizedServiceCap(maxServices: number | undefined): number {
  if (maxServices === undefined || !Number.isFinite(maxServices)) {
    return MAX_SERVICES;
  }

  return Math.max(0, Math.min(MAX_SERVICES, Math.floor(maxServices)));
}
