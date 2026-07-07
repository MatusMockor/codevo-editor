/**
 * Nette **NEON** config navigation + completion intelligence (spec §4.8, Slice
 * 8), a sibling of `useLatteIntelligence`: the workbench controller mounts it
 * with a thin dependency surface (strangler pattern), while every decision lives
 * here so the logic is unit-testable WITHOUT the controller, Monaco, or React.
 *
 * Responsibilities:
 *   - `provideNeonDefinition` (Cmd+B): a service-class reference
 *     (`App\Model\Foo`, entity `Foo(`, `factory: Foo::method`) resolves to its
 *     PHP file through the injected `openClassTarget` (the SAME index + PSR-4
 *     resolver a Laravel `use Foo\Bar;` jump uses); an `includes:` entry resolves
 *     to the referenced `.neon` file, relative to the current config's directory.
 *   - `provideNeonCompletions`: class-name completion inside a `services:` value
 *     position, sourced from the injected workspace class-name search (the
 *     project symbol index, filtered to type symbols).
 *
 * GATING (spec §4.9): every entry point is inert unless BOTH the Nette framework
 * profile is active AND the semantic tier (`fullSmart`) is on. Highlighting runs
 * independently, so a `.neon` file in a non-Nette project (or `basic` mode) gets
 * nothing from here.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace root
 * up front and re-checks the LIVE root after every `await`, dropping stale
 * results so nothing leaks across project tabs. The class-resolution and
 * class-name-search dependencies carry their OWN isolation guards inside the
 * controller; this hook additionally re-checks before its own `openTarget`.
 */

import { useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectNeonClassReferenceAt,
  detectNeonIncludeAt,
  neonServiceClassCompletionContextAt,
} from "../domain/neonConfig";
import {
  detectNeonParameterReferenceAt,
  detectNeonServiceReferenceAt,
  detectNeonServiceSetupMethodAt,
  neonGeneratedServiceNamesFromServices,
  neonParameterCompletionContextAt,
  neonParametersFromSource,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

/**
 * The Monaco icon bucket a NEON completion maps to: a `services:` class name, a
 * `%param%` parameter reference, or an `@service` reference.
 */
export type NeonCompletionItemKind =
  | "class"
  | "method"
  | "parameter"
  | "service";

/**
 * A NEON completion the hook hands to the Monaco "neon" provider. Structurally
 * compatible with the provider's `NeonCompletion`; kept local so the application
 * layer does not depend on the components layer (mirrors `LatteCompletionItem`).
 */
export interface NeonCompletionItem {
  detail?: string;
  insertText: string;
  kind: NeonCompletionItemKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

/** The minimal shape of the active editor document the hook reads (its path). */
export interface NeonIntelligenceActiveDocument {
  path: string;
}

/** A workspace directory entry, narrowed to what the `.neon` config scan needs. */
export interface NeonDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

/**
 * The injected surface the hook needs. Every member is a value or a tiny
 * function so the logic can be exercised with plain fakes - no controller, no
 * Monaco, no React. The controller mount supplies the real collaborators
 * (class resolver, workspace symbol search, navigation opener, path helpers,
 * framework/tier flags) and the live workspace-root ref used for the post-await
 * isolation re-checks.
 */
export interface NeonIntelligenceDependencies {
  /** Live workspace root, read AFTER each await to drop stale results. */
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkIntelligence: PhpFrameworkIntelligence;
  getActiveDocument(): NeonIntelligenceActiveDocument | null;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  /**
   * Lists a directory's entries for the cross-file `.neon` config scan (used to
   * merge `%param%` / `@service` definitions across the project's config files).
   * A pass-through of the controller's workspace directory reader; an unknown
   * directory rejects (mirroring the Tauri gateway) and is skipped.
   */
  listDirectory(path: string): Promise<NeonDirectoryEntry[]>;
  /**
   * Resolves a PHP class name (a NEON reference is already fully qualified) to
   * its source file and opens it, resolving `true` when it navigated. A
   * pass-through of the controller's `openPhpClassTarget` - the SAME index +
   * PSR-4 resolver a plain `use Foo\Bar;` / `new Foo()` jump uses - so a NEON
   * service class navigates exactly like a PHP class reference.
   */
  openClassTarget(className: string): Promise<boolean>;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  /**
   * Workspace class-name search for `services:` completion: returns candidate
   * fully-qualified class names for a typed prefix. A pass-through of the
   * controller's project-symbol index (filtered to type symbols); an empty
   * result (indexing off) simply yields no completions - conservative.
   */
  searchClassNames(
    rootPath: string,
    prefix: string,
    maxResults: number,
  ): Promise<string[]>;
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
  toRelativePath(rootPath: string, path: string): string;
  /** The requested workspace root, captured up front by each async flow. */
  workspaceRoot: string | null;
}

export interface NeonIntelligence {
  provideNeonCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]>;
  provideNeonDefinition(source: string, offset: number): Promise<boolean>;
}

const NEON_MAX_COMPLETIONS = 100;
const NEON_EXTENSION = ".neon";

/**
 * TTL for the per-root project-config listing (parameters + services collected
 * across the project's `.neon` files). A short TTL bounds staleness after a
 * config file changes, while `evictOtherRootConfigCacheEntries` bounds cross-root
 * growth; together they keep a single active project to at most one entry.
 * Precise file-change invalidation is a documented follow-up.
 */
const NEON_CONFIG_CACHE_TTL_MS = 5_000;

/** Hard cap on `.neon` files read in one cross-file scan (hang-safety). */
const NEON_MAX_CONFIG_FILES = 200;

/**
 * Workspace-relative directories a Nette project keeps its config `.neon` files
 * under. The current config file's own directory is always scanned too, so a
 * non-standard layout still resolves same-directory cross-file definitions.
 */
const NEON_CONFIG_SCAN_DIRECTORIES: readonly string[] = ["config", "app/config"];
const NEON_CONFIG_RECURSIVE_SCAN_DIRECTORIES: readonly string[] = [
  "app/modules",
];

/** A definition location the cross-file scan resolves a name to. */
interface NeonDefinitionLocation {
  path: string;
  position: EditorPosition;
}

/** The merged parameters + services of every scanned `.neon` file (per root). */
interface NeonProjectConfig {
  parameterNames: string[];
  parameters: Map<string, NeonDefinitionLocation>;
  serviceNames: string[];
  services: Map<string, NeonDefinitionLocation>;
  serviceTypes: Map<string, NeonDefinitionLocation>;
}

interface NeonConfigCacheEntry {
  config: NeonProjectConfig;
  expiresAt: number;
}

/** Per-root cache of the merged project config (keyed by requested root). */
export type NeonConfigCache = Record<string, NeonConfigCacheEntry>;

/** In-flight config scans keyed by requested root (concurrent callers join). */
type NeonConfigInFlight = Map<string, Promise<NeonProjectConfig>>;

/** Everything one NEON navigation / completion request threads down its chain. */
interface NeonRequestContext {
  configCache: NeonConfigCache;
  configInFlight: NeonConfigInFlight;
  deps: NeonIntelligenceDependencies;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
}

/**
 * Builds the NEON intelligence API from an accessor to the current dependencies
 * (read fresh on every call so gating flags and the workspace root are always
 * current). Exported for direct unit testing; the React hook is a thin, stable
 * wrapper around it.
 */
export function createNeonIntelligence(
  getDependencies: () => NeonIntelligenceDependencies,
  configCache: NeonConfigCache = {},
): NeonIntelligence {
  /**
   * Per-instance in-flight registry for the cross-file config scan, so concurrent
   * completion requests (Monaco fires one per keystroke) share ONE scan per root
   * instead of launching parallel directory reads (mirrors the Latte loaders).
   */
  const configInFlight: NeonConfigInFlight = new Map();

  const provideNeonDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();
    evictOtherRootConfigCacheEntries(configCache, deps.workspaceRoot);

    if (!isNeonSemanticActive(deps)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const context: NeonRequestContext = {
      configCache,
      configInFlight,
      deps,
      isRequestedRootActive,
      requestedRoot,
    };
    const classReference = detectNeonClassReferenceAt(source, offset);

    if (classReference) {
      return deps.openClassTarget(classReference.className);
    }

    const parameterReference = detectNeonParameterReferenceAt(source, offset);

    if (parameterReference) {
      return resolveNeonParameterDefinition(context, source, parameterReference.name);
    }

    const serviceReference = detectNeonServiceReferenceAt(source, offset);

    if (serviceReference) {
      return resolveNeonServiceDefinition(context, source, serviceReference.name);
    }

    const setupMethod = detectNeonServiceSetupMethodAt(source, offset);

    if (setupMethod) {
      return resolveNeonSetupMethodDefinition(context, setupMethod);
    }

    const include = detectNeonIncludeAt(source, offset);

    if (include) {
      return resolveNeonInclude(
        deps,
        requestedRoot,
        isRequestedRootActive,
        include.path,
      );
    }

    return false;
  };

  const provideNeonCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]> => {
    const deps = getDependencies();
    evictOtherRootConfigCacheEntries(configCache, deps.workspaceRoot);

    if (!isNeonSemanticActive(deps)) {
      return [];
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return [];
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const offset = offsetAtEditorPosition(source, position);
    const context: NeonRequestContext = {
      configCache,
      configInFlight,
      deps,
      isRequestedRootActive,
      requestedRoot,
    };

    const parameterCompletion = neonParameterCompletionContextAt(source, offset);

    if (parameterCompletion) {
      return neonParameterCompletions(context, source, parameterCompletion);
    }

    const serviceCompletion = neonServiceReferenceCompletionContextAt(
      source,
      offset,
    );

    if (serviceCompletion) {
      return neonServiceReferenceCompletions(context, source, serviceCompletion);
    }

    const setupMethodCompletion = neonServiceSetupMethodCompletionContextAt(
      source,
      offset,
    );

    if (setupMethodCompletion) {
      return neonServiceSetupMethodCompletions(
        context,
        setupMethodCompletion,
      );
    }

    const classContext = neonServiceClassCompletionContextAt(source, offset);

    if (!classContext) {
      return [];
    }

    const names = await deps.searchClassNames(
      requestedRoot,
      classContext.prefix,
      NEON_MAX_COMPLETIONS,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    return names.slice(0, NEON_MAX_COMPLETIONS).map((name) => ({
      detail: "Nette service class",
      insertText: name,
      kind: "class" as const,
      label: name,
      replaceEnd: classContext.span.end,
      replaceStart: classContext.span.start,
    }));
  };

  return { provideNeonCompletions, provideNeonDefinition };
}

/**
 * Thin React wrapper: keeps a live dependency ref (so the stable API always sees
 * the latest gating flags / root), then builds the intelligence API exactly once
 * so its callback identities never churn across renders.
 */
export function useNeonIntelligence(
  dependencies: NeonIntelligenceDependencies,
): NeonIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const configCacheRef = useRef<NeonConfigCache>({});
  const apiRef = useRef<NeonIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createNeonIntelligence(
      () => dependenciesRef.current,
      configCacheRef.current,
    );
  }

  return apiRef.current;
}

function isNeonSemanticActive(deps: NeonIntelligenceDependencies): boolean {
  return deps.frameworkIntelligence.isNette && deps.isSemanticIntelligenceActive;
}

/**
 * Evicts every cached root except `requestedRoot` (spec §6b cache lifecycle):
 * with a single active project tab the per-root config cache holds at most one
 * entry, so switching projects - or closing the active one - never leaves a
 * previous root's config cached forever. Called synchronously at the top of each
 * async flow, before its first `await`, so it runs against a fresh
 * `requestedRoot`.
 */
function evictOtherRootConfigCacheEntries(
  cache: NeonConfigCache,
  requestedRoot: string | null,
): void {
  for (const cachedRoot of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cachedRoot, requestedRoot)) {
      continue;
    }

    delete cache[cachedRoot];
  }
}

/**
 * Navigates a `%param%` reference to its definition: the CURRENT file's
 * `parameters:` leaf first (no I/O), then the merged cross-file project config.
 * Conservative: an unknown parameter resolves to `false`. The post-await
 * live-root re-check drops a switched project's result.
 */
async function resolveNeonParameterDefinition(
  context: NeonRequestContext,
  source: string,
  name: string,
): Promise<boolean> {
  const { deps, isRequestedRootActive } = context;
  const currentPath = deps.getActiveDocument()?.path ?? null;
  const sameFileOffset = neonParameterOffsetInSource(source, name);

  if (sameFileOffset !== null && currentPath) {
    return deps.openTarget(
      currentPath,
      editorPositionAtOffset(source, sameFileOffset),
      `%${name}%`,
    );
  }

  const config = await loadNeonProjectConfig(context);

  if (!isRequestedRootActive()) {
    return false;
  }

  const location = config.parameters.get(name);

  if (!location) {
    return false;
  }

  return deps.openTarget(location.path, location.position, `%${name}%`);
}

/**
 * Navigates an `@service` reference to its definition: a class-typed reference
 * (`@\App\Class`, `@Foo\Bar`) resolves through the class index (autowiring by
 * type); a named `@service` resolves to the CURRENT file's `services:` entry
 * first (no I/O), then the merged cross-file project config. Conservative: an
 * unknown named service resolves to `false`.
 */
async function resolveNeonServiceDefinition(
  context: NeonRequestContext,
  source: string,
  name: string,
): Promise<boolean> {
  const { deps, isRequestedRootActive } = context;
  const normalizedType = name.includes("\\")
    ? normalizeNeonServiceType(name)
    : null;
  const currentPath = deps.getActiveDocument()?.path ?? null;
  const sameFileOffset = neonServiceOffsetInSource(source, name);

  if (sameFileOffset !== null && currentPath) {
    return deps.openTarget(
      currentPath,
      editorPositionAtOffset(source, sameFileOffset),
      `@${name}`,
    );
  }

  if (normalizedType === null) {
    const config = await loadNeonProjectConfig(context);

    if (!isRequestedRootActive()) {
      return false;
    }

    const location = config.services.get(name);

    if (!location) {
      return false;
    }

    return deps.openTarget(location.path, location.position, `@${name}`);
  }

  const config = await loadNeonProjectConfig(context);

  if (!isRequestedRootActive()) {
    return false;
  }

  const location = config.serviceTypes.get(normalizedType);

  if (location) {
    return deps.openTarget(location.path, location.position, `@${name}`);
  }

  return deps.openClassTarget(normalizedType);
}

/**
 * Navigates a `setup:` method call (`- setLogger(...)`) to the method on the
 * owning service class. The domain detector already rejects delegated calls such
 * as `@logger::setMailer()`, so this stays bound to the configured service.
 */
async function resolveNeonSetupMethodDefinition(
  context: NeonRequestContext,
  setupMethod: {
    methodName: string;
    service: { className: string | null; factory: string | null };
  },
): Promise<boolean> {
  const serviceType = neonSetupServiceType(setupMethod.service);

  if (!serviceType) {
    return false;
  }

  return context.deps.openDirectPhpMethodTarget(
    serviceType,
    setupMethod.methodName,
  );
}

/** The offset of the first `parameters:` leaf named `name` in `source`, or `null`. */
function neonParameterOffsetInSource(source: string, name: string): number | null {
  for (const parameter of neonParametersFromSource(source)) {
    if (parameter.name === name) {
      return parameter.offset;
    }
  }

  return null;
}

/** The offset of the first named service `name` in `source`, or `null`. */
function neonServiceOffsetInSource(source: string, name: string): number | null {
  const services = neonServicesFromSource(source);
  const normalizedType = name.includes("\\")
    ? normalizeNeonServiceType(name)
    : null;

  for (const service of services) {
    if (service.serviceName === name) {
      return service.offset;
    }

    if (
      normalizedType &&
      service.className &&
      normalizeNeonServiceType(service.className) === normalizedType
    ) {
      return service.offset;
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    if (generated.name === name) {
      return generated.service.offset;
    }
  }

  return null;
}

function normalizeNeonServiceType(type: string): string {
  return type.replace(/^\\+/, "");
}

/**
 * `%param%` completion: the merged parameter names (current file + cross-file
 * project config), filtered by the typed prefix. The post-await live-root
 * re-check drops a switched project's result.
 */
async function neonParameterCompletions(
  context: NeonRequestContext,
  source: string,
  completion: { prefix: string; span: { end: number; start: number } },
): Promise<NeonCompletionItem[]> {
  const names = await collectNeonParameterNames(context, source);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Nette parameter",
      insertText: name,
      kind: "parameter" as const,
      label: name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

/**
 * `@service` completion: the merged service names (current file + cross-file
 * project config), filtered by the typed prefix.
 */
async function neonServiceReferenceCompletions(
  context: NeonRequestContext,
  source: string,
  completion: { prefix: string; span: { end: number; start: number } },
): Promise<NeonCompletionItem[]> {
  const names = await collectNeonServiceNames(context, source);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Nette service",
      insertText: name,
      kind: "service" as const,
      label: name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

/**
 * `setup:` method completion: infer the owning service class from the service
 * entry (`class:`, `type:`, class-valued `factory:` / `create:`), then reuse the
 * PHP member-completion engine through a synthetic typed receiver. This keeps
 * Nette config completion consistent with `$service->` in PHP without adding a
 * second method-index implementation here.
 */
async function neonServiceSetupMethodCompletions(
  context: NeonRequestContext,
  completion: {
    prefix: string;
    service: { className: string | null; factory: string | null };
    span: { end: number; start: number };
  },
): Promise<NeonCompletionItem[]> {
  const serviceType = neonSetupServiceType(completion.service);

  if (!serviceType) {
    return [];
  }

  const synthetic = context.deps.synthesizeTypedReceiverSource(
    "service",
    serviceType,
  );
  const members = await context.deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    "$service->",
  );

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return orderPhpMemberCompletionsByCategory(members)
    .filter(isCallablePhpMethodCompletion)
    .filter((member) => member.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((member) => ({
      detail: neonSetupMethodCompletionDetail(member),
      insertText: neonSetupMethodCompletionInsertText(member),
      kind: "method" as const,
      label: member.name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

function isCallablePhpMethodCompletion(member: PhpMethodCompletion): boolean {
  return member.kind !== "property" && member.kind !== "relation";
}

function neonSetupServiceType(service: {
  className: string | null;
  factory: string | null;
}): string | null {
  if (service.className) {
    return normalizeNeonServiceType(service.className);
  }

  if (!service.factory) {
    return null;
  }

  const factoryClass = service.factory.split("::")[0]?.trim() ?? "";

  if (!factoryClass || factoryClass.startsWith("@")) {
    return null;
  }

  return normalizeNeonServiceType(factoryClass);
}

function neonSetupMethodCompletionInsertText(member: PhpMethodCompletion): string {
  if (member.insertText) {
    return member.insertText;
  }

  return `${member.name}()`;
}

function neonSetupMethodCompletionDetail(member: PhpMethodCompletion): string {
  const parameters = member.parameters ? `(${member.parameters})` : "()";
  const returnType = member.returnType ? `: ${member.returnType}` : "";

  return `${member.declaringClassName}::${member.name}${parameters}${returnType}`;
}

/** Merged parameter names: current file (no I/O) unioned with the project config. */
async function collectNeonParameterNames(
  context: NeonRequestContext,
  source: string,
): Promise<string[]> {
  const names = new Set<string>();

  for (const parameter of neonParametersFromSource(source)) {
    names.add(parameter.name);
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  for (const name of config.parameterNames) {
    names.add(name);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

/** Merged service names: current file (no I/O) unioned with the project config. */
async function collectNeonServiceNames(
  context: NeonRequestContext,
  source: string,
): Promise<string[]> {
  const names = new Set<string>();
  const services = neonServicesFromSource(source);

  for (const service of services) {
    if (service.serviceName) {
      names.add(service.serviceName);
    }

    if (service.className) {
      names.add(service.className);
    }
  }

  for (const generated of neonGeneratedServiceNamesFromServices(services)) {
    names.add(generated.name);
  }

  const config = await loadNeonProjectConfig(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  for (const name of config.serviceNames) {
    names.add(name);
  }

  for (const name of config.serviceTypes.keys()) {
    names.add(name);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

/**
 * Loads (and per-root caches) the merged project config. Concurrent callers for
 * the same root share one in-flight scan (Monaco fires a completion per
 * keystroke), mirroring the Latte loaders.
 */
async function loadNeonProjectConfig(
  context: NeonRequestContext,
): Promise<NeonProjectConfig> {
  const { configCache, configInFlight, requestedRoot } = context;
  const cached = configCache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const existing = configInFlight.get(requestedRoot);

  if (existing) {
    return existing;
  }

  const load = scanNeonProjectConfig(context).finally(() => {
    if (configInFlight.get(requestedRoot) === load) {
      configInFlight.delete(requestedRoot);
    }
  });

  configInFlight.set(requestedRoot, load);

  return load;
}

function emptyNeonProjectConfig(): NeonProjectConfig {
  return {
    parameterNames: [],
    parameters: new Map(),
    serviceNames: [],
    services: new Map(),
    serviceTypes: new Map(),
  };
}

/**
 * The actual cross-file scan: collect the project's `.neon` files, read each
 * once, and merge their `parameters:` / named `services:` definitions (first
 * definition of a name wins). Per-project isolation: `requestedRoot` was captured
 * by the caller and re-checked after EVERY await; a stale root drops the result
 * without writing the cache.
 */
async function scanNeonProjectConfig(
  context: NeonRequestContext,
): Promise<NeonProjectConfig> {
  const { configCache, deps, isRequestedRootActive, requestedRoot } = context;
  const filePaths = await collectNeonFilePaths(context);

  if (!isRequestedRootActive()) {
    return emptyNeonProjectConfig();
  }

  const parameters = new Map<string, NeonDefinitionLocation>();
  const services = new Map<string, NeonDefinitionLocation>();
  const serviceTypes = new Map<string, NeonDefinitionLocation>();
  let generatedServiceStartIndex = 1;

  for (const path of filePaths) {
    if (!isRequestedRootActive()) {
      return emptyNeonProjectConfig();
    }

    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return emptyNeonProjectConfig();
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return emptyNeonProjectConfig();
    }

    for (const parameter of neonParametersFromSource(content)) {
      if (!parameters.has(parameter.name)) {
        parameters.set(parameter.name, {
          path,
          position: editorPositionAtOffset(content, parameter.offset),
        });
      }
    }

    const sourceServices = neonServicesFromSource(content);

    for (const service of sourceServices) {
      if (service.serviceName && !services.has(service.serviceName)) {
        services.set(service.serviceName, {
          path,
          position: editorPositionAtOffset(content, service.offset),
        });
      }

      const serviceType = service.className
        ? normalizeNeonServiceType(service.className)
        : null;

      if (serviceType && !serviceTypes.has(serviceType)) {
        serviceTypes.set(serviceType, {
          path,
          position: editorPositionAtOffset(content, service.offset),
        });
      }
    }

    const generated = neonGeneratedServiceNamesFromServices(
      sourceServices,
      generatedServiceStartIndex,
    );
    generatedServiceStartIndex += generated.length;

    for (const entry of generated) {
      if (!services.has(entry.name)) {
        services.set(entry.name, {
          path,
          position: editorPositionAtOffset(content, entry.service.offset),
        });
      }
    }
  }

  if (!isRequestedRootActive()) {
    return emptyNeonProjectConfig();
  }

  const config: NeonProjectConfig = {
    parameterNames: Array.from(parameters.keys()).sort((left, right) =>
      left.localeCompare(right),
    ),
    parameters,
    serviceNames: Array.from(services.keys()).sort((left, right) =>
      left.localeCompare(right),
    ),
    services,
    serviceTypes,
  };
  configCache[requestedRoot] = {
    config,
    expiresAt: Date.now() + NEON_CONFIG_CACHE_TTL_MS,
  };

  return config;
}

/**
 * Collects the workspace `.neon` config file paths from the candidate scan
 * directories (the current config's own directory plus conventional `config` /
 * `app/config`) and recursively from module config folders, bounded by
 * `NEON_MAX_CONFIG_FILES`. Per-project isolation: re-checks the live root after
 * every directory read.
 */
async function collectNeonFilePaths(
  context: NeonRequestContext,
): Promise<string[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const paths = new Set<string>();

  for (const directory of neonScanDirectories(deps, requestedRoot)) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (paths.size >= NEON_MAX_CONFIG_FILES) {
      break;
    }

    let entries: NeonDirectoryEntry[];

    try {
      entries = await deps.listDirectory(directory);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const entry of entries) {
      if (paths.size >= NEON_MAX_CONFIG_FILES) {
        break;
      }

      if (entry.kind === "file" && entry.path.endsWith(NEON_EXTENSION)) {
        paths.add(entry.path);
      }
    }
  }

  for (const directory of recursiveNeonScanDirectories(deps, requestedRoot)) {
    if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
      break;
    }

    await collectNeonFilePathsUnderDirectory(context, directory, paths);
  }

  return Array.from(paths);
}

async function collectNeonFilePathsUnderDirectory(
  context: NeonRequestContext,
  directory: string,
  paths: Set<string>,
): Promise<void> {
  const { deps, isRequestedRootActive } = context;

  if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
    return;
  }

  let entries: NeonDirectoryEntry[];

  try {
    entries = await deps.listDirectory(directory);
  } catch {
    return;
  }

  if (!isRequestedRootActive()) {
    return;
  }

  for (const entry of entries) {
    if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
      return;
    }

    if (entry.kind === "file") {
      if (entry.path.endsWith(NEON_EXTENSION)) {
        paths.add(entry.path);
      }

      continue;
    }

    await collectNeonFilePathsUnderDirectory(context, entry.path, paths);
  }
}

/**
 * The absolute directories the `.neon` config scan visits: the current config
 * file's own directory (so a non-standard layout still resolves), plus the
 * conventional `config` / `app/config` directories. De-duplicated.
 */
function neonScanDirectories(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
): string[] {
  const directories = new Set<string>();
  const currentPath = deps.getActiveDocument()?.path ?? null;

  if (currentPath) {
    const directory = dirnameOf(currentPath);

    if (directory.length > 0) {
      directories.add(directory);
    }
  }

  for (const relative of NEON_CONFIG_SCAN_DIRECTORIES) {
    directories.add(deps.joinPath(requestedRoot, relative));
  }

  return Array.from(directories);
}

/** Conventional module root scanned recursively for ebox-crm style configs. */
function recursiveNeonScanDirectories(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
): string[] {
  return NEON_CONFIG_RECURSIVE_SCAN_DIRECTORIES.map((relative) =>
    deps.joinPath(requestedRoot, relative),
  );
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: clamped - lineStart + 1,
    lineNumber: before.split("\n").length,
  };
}

/**
 * Resolves an `includes:` entry to its `.neon` file (relative to the current
 * config's directory, how NEON resolves includes), verifies it exists via the
 * injected reader, and opens it. Conservative: a path that escapes the workspace
 * root, or a non-existent file, resolves to `false`. The live-root re-check
 * after the read drops a switched project's result.
 */
async function resolveNeonInclude(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  includePath: string,
): Promise<boolean> {
  const currentRelativePath = currentNeonRelativePath(deps, requestedRoot);
  const relativePath = resolveNeonRelativePath(includePath, currentRelativePath);

  if (!relativePath) {
    return false;
  }

  const path = deps.joinPath(requestedRoot, relativePath);

  try {
    await deps.readFileContent(path);
  } catch {
    return false;
  }

  if (!isRequestedRootActive()) {
    return false;
  }

  return deps.openTarget(path, { column: 1, lineNumber: 1 }, includePath);
}

function currentNeonRelativePath(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
): string {
  const document = deps.getActiveDocument();

  if (!document) {
    return "";
  }

  return deps.toRelativePath(requestedRoot, document.path);
}

/**
 * Resolves a NEON include reference to a workspace-relative path, against the
 * current config's directory (a leading `/` is workspace-root relative). `.`/
 * `..` segments are collapsed; a reference that escapes above the root, or is
 * blank, resolves to `null`. A `.neon` extension is appended when the reference
 * has none.
 */
function resolveNeonRelativePath(
  includePath: string,
  currentRelativePath: string,
): string | null {
  const reference = includePath.split("\\").join("/").trim();

  if (reference.length === 0) {
    return null;
  }

  const rootRelative = reference.startsWith("/");
  const base = rootRelative
    ? ""
    : dirnameOf(currentRelativePath.split("\\").join("/").trim());
  const body = rootRelative ? reference.replace(/^\/+/, "") : reference;
  const combined = base.length > 0 ? `${base}/${body}` : body;
  const segments = collapseRelative(combined);

  if (!segments) {
    return null;
  }

  const path = segments.join("/");
  const lastSegment = segments[segments.length - 1] ?? "";

  return lastSegment.includes(".") ? path : `${path}${NEON_EXTENSION}`;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}

/**
 * Collapses `.`/`..`/empty segments. Returns `null` when the path escapes above
 * the workspace root or collapses to nothing.
 */
function collapseRelative(path: string): string[] | null {
  const result: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  return result.length > 0 ? result : null;
}

function offsetAtEditorPosition(source: string, position: EditorPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}
