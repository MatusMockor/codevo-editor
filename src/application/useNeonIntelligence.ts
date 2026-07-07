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
 * GATING (spec §4.9): every entry point is inert unless BOTH an active framework
 * provider opts into NEON config intelligence AND the semantic tier (`fullSmart`)
 * is on. Highlighting runs independently, so a `.neon` file in a non-Nette
 * project (or `basic` mode) gets nothing from here.
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
  neonServiceClassCompletionContextAt,
} from "../domain/neonConfig";
import {
  neonGeneratedServiceNamesFromServices,
  neonParameterCompletionContextAt,
  neonParametersFromSource,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  provideNeonDefinition as provideNeonDefinitionFromProvider,
} from "./neonDefinitionProvider";
import {
  createNeonRequestContext,
  offsetAtEditorPosition,
  type NeonRequestContext as NeonRuntimeRequestContext,
} from "./neonIntelligenceRuntime";
import {
  loadNeonProjectConfig,
  neonResolvableServiceType,
  type NeonConfigCache,
  type NeonConfigInFlight,
} from "./neonProjectConfigDiscovery";

export type { NeonConfigCache } from "./neonProjectConfigDiscovery";

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

type NeonRequestContext =
  NeonRuntimeRequestContext<NeonIntelligenceDependencies>;

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
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return false;
    }

    return provideNeonDefinitionFromProvider(context, source, offset);
  };

  const provideNeonCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]> => {
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return [];
    }

    const { deps, isRequestedRootActive, requestedRoot } = context;
    const offset = offsetAtEditorPosition(source, position);

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
  const serviceType = neonResolvableServiceType(completion.service);

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

    const serviceType = neonResolvableServiceType(service);

    if (serviceType) {
      names.add(serviceType);
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
