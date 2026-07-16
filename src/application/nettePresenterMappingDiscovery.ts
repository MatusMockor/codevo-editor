import {
  nettePresenterMappingsFromPhpSource,
  normalizeNettePresenterMappings,
  type NettePresenterMapping,
  type NettePresenterMappingInput,
  type NettePresenterMappingMask,
} from "../domain/nettePresenterMapping";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";

export interface NettePresenterMappingDiscoveryDependencies {
  readFileContent(path: string): Promise<string>;
  searchText(
    rootPath: string,
    query: string,
    maxResults: number,
  ): Promise<{ path: string }[]>;
}

export interface NettePresenterMappingCacheEntry {
  expiresAt: number;
  mappings: NettePresenterMapping[];
}

export type NettePresenterMappingCache = Record<
  string,
  NettePresenterMappingCacheEntry
>;
export type NettePresenterMappingInFlight = Map<
  string,
  Promise<NettePresenterMapping[]>
>;

export interface NettePresenterMappingGeneration {
  next: number;
  roots: Record<string, number>;
}

export interface NettePresenterMappingDiscoveryContext {
  cache: NettePresenterMappingCache;
  deps: NettePresenterMappingDiscoveryDependencies;
  generation: NettePresenterMappingGeneration;
  inFlight: NettePresenterMappingInFlight;
  isRequestedRootActive(): boolean;
  maxSearchResults: number;
  requestedRoot: string;
  ttlMs: number;
}

const PHP_MAPPING_QUERY = "setMapping";
const NEON_APPLICATION_QUERY = "application:";
const MAX_NEON_SOURCE_CHARACTERS = 500_000;

export function createNettePresenterMappingGeneration(): NettePresenterMappingGeneration {
  return { next: 0, roots: {} };
}

export function captureNettePresenterMappingGeneration(
  generation: NettePresenterMappingGeneration,
  rootPath: string,
): { generation: number; isCurrent(): boolean; rootKey: string } {
  const rootKey = ensureRootGeneration(generation, rootPath);
  const captured = generation.roots[rootKey] ?? 0;

  return {
    generation: captured,
    isCurrent: () => generation.roots[rootKey] === captured,
    rootKey,
  };
}

export async function loadNettePresenterMappings(
  context: NettePresenterMappingDiscoveryContext,
): Promise<NettePresenterMapping[]> {
  const rootKey = ensureRootGeneration(context.generation, context.requestedRoot);
  const cached = context.cache[rootKey];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.mappings;
  }

  const existing = context.inFlight.get(rootKey);

  if (existing) {
    return existing;
  }

  const generation = context.generation.roots[rootKey] ?? 0;
  const load = scanNettePresenterMappings(context, rootKey, generation).finally(
    () => {
      if (context.inFlight.get(rootKey) === load) {
        context.inFlight.delete(rootKey);
      }
    },
  );
  context.inFlight.set(rootKey, load);

  return load;
}

export function invalidateNettePresenterMappingsForPath(
  cache: NettePresenterMappingCache,
  inFlight: NettePresenterMappingInFlight,
  generation: NettePresenterMappingGeneration,
  rootPath: string | null,
  path: string,
): void {
  if (!rootPath || (!path.endsWith(".php") && !path.endsWith(".neon"))) {
    return;
  }

  const rootKey = normalizedWorkspaceRootKey(rootPath);
  delete cache[rootKey];
  inFlight.delete(rootKey);
  generation.next = Math.max(
    generation.next,
    generation.roots[rootKey] ?? 0,
  ) + 1;
  generation.roots[rootKey] = generation.next;
}

export function evictOtherRootPresenterMappingEntries(
  cache: NettePresenterMappingCache,
  inFlight: NettePresenterMappingInFlight,
  generation: NettePresenterMappingGeneration,
  requestedRoot: string | null,
): void {
  const activeRoot = requestedRoot
    ? normalizedWorkspaceRootKey(requestedRoot)
    : null;
  const roots = new Set([
    ...Object.keys(cache),
    ...inFlight.keys(),
    ...Object.keys(generation.roots),
  ]);

  for (const root of roots) {
    if (activeRoot && workspaceRootKeysEqual(root, activeRoot)) {
      continue;
    }

    delete cache[root];
    inFlight.delete(root);
    delete generation.roots[root];
  }
}

export function nettePresenterMappingsFromNeonSource(
  source: string,
): NettePresenterMapping[] {
  if (source.length > MAX_NEON_SOURCE_CHARACTERS) {
    return [];
  }

  const inputs: NettePresenterMappingInput[] = [];
  let applicationIndent: number | null = null;
  let mappingIndent: number | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripNeonComment(rawLine);

    if (!line.trim()) {
      continue;
    }

    const indent = neonIndent(line);
    const trimmed = line.trim();

    if (applicationIndent !== null && indent <= applicationIndent) {
      applicationIndent = null;
      mappingIndent = null;
    }

    if (mappingIndent !== null && indent <= mappingIndent) {
      mappingIndent = null;
    }

    if (/^application\s*:\s*$/.test(trimmed)) {
      applicationIndent = indent;
      mappingIndent = null;
      continue;
    }

    if (applicationIndent !== null && indent > applicationIndent) {
      const mappingMatch = /^mapping\s*:\s*(.*)$/.exec(trimmed);

      if (mappingMatch) {
        const rawMask = (mappingMatch[1] ?? "").trim();

        if (!rawMask) {
          mappingIndent = indent;
          continue;
        }

        const mask = staticNeonMappingMask(rawMask);

        if (mask) {
          inputs.push({ mask, module: "*" });
        }

        mappingIndent = null;
        continue;
      }
    }

    if (mappingIndent === null || indent <= mappingIndent) {
      continue;
    }

    const entry = neonMappingInput(trimmed);

    if (entry) {
      inputs.push(entry);
    }
  }

  return normalizeNettePresenterMappings(inputs);
}

async function scanNettePresenterMappings(
  context: NettePresenterMappingDiscoveryContext,
  rootKey: string,
  generation: number,
): Promise<NettePresenterMapping[]> {
  const { deps, isRequestedRootActive, maxSearchResults, requestedRoot } =
    context;
  const neonResults = await deps.searchText(
    requestedRoot,
    NEON_APPLICATION_QUERY,
    maxSearchResults,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const phpResults = await deps.searchText(
    requestedRoot,
    PHP_MAPPING_QUERY,
    maxSearchResults,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const neonMappings = await mappingsFromSearchResults(
    context,
    neonResults,
    ".neon",
    nettePresenterMappingsFromNeonSource,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const phpMappings = await mappingsFromSearchResults(
    context,
    phpResults,
    ".php",
    nettePresenterMappingsFromPhpSource,
  );
  const mappings = distinctMappings([...neonMappings, ...phpMappings]);

  if (!isRequestedRootActive()) {
    return [];
  }

  if (context.generation.roots[rootKey] !== generation) {
    return mappings;
  }

  context.cache[rootKey] = {
    expiresAt: Date.now() + context.ttlMs,
    mappings,
  };

  return mappings;
}

async function mappingsFromSearchResults(
  context: NettePresenterMappingDiscoveryContext,
  results: readonly { path: string }[],
  extension: string,
  parse: (source: string) => NettePresenterMapping[],
): Promise<NettePresenterMapping[]> {
  const mappings: NettePresenterMapping[] = [];
  const paths = Array.from(
    new Set(
      results
        .map((result) => result.path)
        .filter((path) => path.endsWith(extension)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  for (const path of paths) {
    if (!context.isRequestedRootActive()) {
      return [];
    }

    try {
      const source = await context.deps.readFileContent(path);

      if (!context.isRequestedRootActive()) {
        return [];
      }

      mappings.push(...parse(source));
    } catch {
      if (!context.isRequestedRootActive()) {
        return [];
      }
    }
  }

  return mappings;
}

function distinctMappings(
  mappings: readonly NettePresenterMapping[],
): NettePresenterMapping[] {
  const bySignature = new Map<string, NettePresenterMapping>();

  for (const mapping of mappings) {
    bySignature.set(mappingSignature(mapping), mapping);
  }

  return Array.from(bySignature.values()).sort((left, right) =>
    mappingSignature(left).localeCompare(mappingSignature(right)),
  );
}

function mappingSignature(mapping: NettePresenterMapping): string {
  return [
    mapping.module,
    mapping.namespace,
    mapping.moduleMask,
    mapping.presenterMask,
  ].join("\0");
}

function ensureRootGeneration(
  generation: NettePresenterMappingGeneration,
  rootPath: string,
): string {
  const rootKey = normalizedWorkspaceRootKey(rootPath);

  if (generation.roots[rootKey] === undefined) {
    generation.next += 1;
    generation.roots[rootKey] = generation.next;
  }

  return rootKey;
}

function neonMappingInput(line: string): NettePresenterMappingInput | null {
  const match = /^([^:]+?)\s*:\s*(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  const module = unquoteNeonScalar(match[1] ?? "");
  const rawMask = (match[2] ?? "").trim();

  if (!module || !rawMask || rawMask.startsWith("%") || rawMask.startsWith("@")) {
    return null;
  }

  const mask = neonMappingMask(rawMask);

  return mask ? { mask, module } : null;
}

function neonMappingMask(raw: string): NettePresenterMappingMask | null {
  if (!raw.startsWith("[")) {
    return unquoteNeonScalar(raw) || null;
  }

  if (!raw.endsWith("]")) {
    return null;
  }

  const parts = splitNeonTuple(raw.slice(1, -1));

  if (parts.length !== 3) {
    return null;
  }

  const values = parts.map(unquoteNeonScalar);

  if (!values[0] || !values[2]) {
    return null;
  }

  return values as [string, string, string];
}

function staticNeonMappingMask(raw: string): NettePresenterMappingMask | null {
  if (!raw || raw.startsWith("%") || raw.startsWith("@")) {
    return null;
  }

  return neonMappingMask(raw);
}

function splitNeonTuple(source: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === quote && source[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === ",") {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts;
}

function unquoteNeonScalar(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const last = value[value.length - 1];

  if ((first === "'" || first === '"') && last === first) {
    return value.slice(1, -1);
  }

  return value;
}

function stripNeonComment(line: string): string {
  let quote = "";

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";

    if (quote) {
      if (character === quote && line[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "#") {
      return line.slice(0, index);
    }
  }

  return line;
}

function neonIndent(line: string): number {
  let indent = 0;

  for (const character of line) {
    if (character === " ") {
      indent += 1;
      continue;
    }

    if (character === "\t") {
      indent += 4;
      continue;
    }

    break;
  }

  return indent;
}
