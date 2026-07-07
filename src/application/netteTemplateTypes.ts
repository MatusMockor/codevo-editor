import { latteVariableDeclarations } from "../domain/latteSyntax";
import {
  netteTemplateClassPropertiesFromSource,
  type NetteTemplateProperty,
} from "../domain/netteViewData";

export interface NetteTemplateTypeSearchResult {
  path: string;
}

export interface NetteTemplateTypeDependencies {
  readFileContent(path: string): Promise<string>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  searchText(
    rootPath: string,
    query: string,
    limit: number,
  ): Promise<NetteTemplateTypeSearchResult[]>;
}

export interface LatteTemplateTypePropertySighting {
  property: NetteTemplateProperty;
  source: string;
}

export interface LatteTemplateTypeCacheEntry {
  expiresAt: number;
  sightingsByTypeName: Record<string, LatteTemplateTypePropertySighting[]>;
}

export type LatteTemplateTypeCache = Record<string, LatteTemplateTypeCacheEntry>;

export type LatteTemplateTypeInFlight = Map<
  string,
  Promise<LatteTemplateTypePropertySighting[]>
>;

export interface LatteTemplateTypeContext {
  cache: LatteTemplateTypeCache;
  deps: NetteTemplateTypeDependencies;
  inFlight: LatteTemplateTypeInFlight;
  isRequestedRootActive(): boolean;
  phpExtension: string;
  requestedRoot: string;
  searchLimit: number;
  ttlMs: number;
}

export async function latteTemplateTypeVariableType(
  context: LatteTemplateTypeContext,
  source: string,
  variableName: string,
): Promise<string | null> {
  const target = `$${variableName}`;
  const sightings = await latteTemplateTypePropertySightings(context, source);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  const resolved: (string | null)[] = [];

  for (const sighting of sightings) {
    if (sighting.property.name !== target) {
      continue;
    }

    resolved.push(
      context.deps.resolveDeclaredType(
        sighting.source,
        sighting.property.type,
      ) ?? sighting.property.type,
    );
  }

  return mergeLatteResolvedTypes(resolved);
}

export async function latteTemplateTypePropertySightings(
  context: LatteTemplateTypeContext,
  source: string,
): Promise<LatteTemplateTypePropertySighting[]> {
  const typeNames = latteTemplateTypeNames(source);

  if (typeNames.length === 0) {
    return [];
  }

  const sightings: LatteTemplateTypePropertySighting[] = [];

  for (const typeName of typeNames) {
    sightings.push(...(await loadNetteTemplateTypeProperties(context, typeName)));

    if (!context.isRequestedRootActive()) {
      return [];
    }
  }

  return sightings;
}

export function latteTemplateTypeNames(source: string): string[] {
  const names = new Set<string>();

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "templateType" || !declaration.typeName) {
      continue;
    }

    names.add(declaration.typeName);
  }

  return Array.from(names);
}

export async function loadNetteTemplateTypeProperties(
  context: LatteTemplateTypeContext,
  typeName: string,
): Promise<LatteTemplateTypePropertySighting[]> {
  const { cache, inFlight, requestedRoot } = context;
  const cached = cache[requestedRoot];

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    Object.prototype.hasOwnProperty.call(cached.sightingsByTypeName, typeName)
  ) {
    return cached.sightingsByTypeName[typeName] ?? [];
  }

  const key = `${requestedRoot}\0${typeName}`;
  const existingLoad = inFlight.get(key);

  if (existingLoad) {
    return existingLoad;
  }

  const load = scanNetteTemplateTypeProperties(context, typeName).finally(() => {
    if (inFlight.get(key) === load) {
      inFlight.delete(key);
    }
  });

  inFlight.set(key, load);

  return load;
}

export function mergeLatteResolvedTypes(
  types: readonly (string | null)[],
): string | null {
  const resolved = types.filter((type): type is string => Boolean(type));

  if (resolved.length === 0) {
    return null;
  }

  const first = resolved[0] ?? "";
  const normalize = (type: string) =>
    type.trim().replace(/^\\+/, "").toLowerCase();

  return resolved.every((type) => normalize(type) === normalize(first))
    ? first
    : null;
}

async function scanNetteTemplateTypeProperties(
  context: LatteTemplateTypeContext,
  typeName: string,
): Promise<LatteTemplateTypePropertySighting[]> {
  const {
    cache,
    deps,
    isRequestedRootActive,
    phpExtension,
    requestedRoot,
    searchLimit,
    ttlMs,
  } = context;
  const shortName = shortTypeName(typeName);

  if (!shortName) {
    return [];
  }

  const results = await deps.searchText(
    requestedRoot,
    `class ${shortName}`,
    searchLimit,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const visitedPaths = new Set<string>();
  const sightings: LatteTemplateTypePropertySighting[] = [];

  for (const result of results) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(phpExtension)) {
      continue;
    }

    visitedPaths.add(result.path);

    let content: string;

    try {
      content = await deps.readFileContent(result.path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    if (!phpSourceDefinesType(content, typeName)) {
      continue;
    }

    for (const property of netteTemplateClassPropertiesFromSource(
      content,
      shortName,
    )) {
      sightings.push({ property, source: content });
    }
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  const existing =
    cache[requestedRoot]?.expiresAt > Date.now()
      ? cache[requestedRoot]?.sightingsByTypeName
      : undefined;

  cache[requestedRoot] = {
    expiresAt: Date.now() + ttlMs,
    sightingsByTypeName: {
      ...(existing ?? {}),
      [typeName]: sightings,
    },
  };

  return sightings;
}

function phpSourceDefinesType(source: string, typeName: string): boolean {
  const normalizedType = typeName.replace(/^\\+/, "");
  const shortName = shortTypeName(typeName);

  if (!shortName || !phpSourceHasClass(source, shortName)) {
    return false;
  }

  const namespace = phpNamespaceName(source);

  if (!namespace || !normalizedType.includes("\\")) {
    return shortName === normalizedType.split("\\").pop();
  }

  return `${namespace}\\${shortName}` === normalizedType;
}

function phpSourceHasClass(source: string, shortName: string): boolean {
  const pattern = new RegExp(
    `\\b(?:class|interface|trait)\\s+${escapeRegExp(shortName)}\\b`,
  );

  return pattern.test(source);
}

function phpNamespaceName(source: string): string | null {
  const match = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source);

  if (!match?.[1]) {
    return null;
  }

  return match[1].trim().replace(/\s+/g, "");
}

function shortTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const normalized = typeName.replace(/^\?/, "").replace(/^\\+/, "");
  const parts = normalized.split("\\").filter(Boolean);

  return parts[parts.length - 1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
