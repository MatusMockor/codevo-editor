import type { EditorPosition } from "../domain/languageServerFeatures";
import { neonServiceClassCompletionContextAt } from "../domain/neonConfig";
import {
  compatibleNeonConfigKeySpecsForScope,
  netteComposerPackageVersionsFromLock,
  neonConfigKeyCompletionContextAt,
  neonConfigKeyScopeRequiresComposerVersion,
  neonExtensionNamesFromSource,
  neonIndentUnitFromSource,
  type NeonConfigKeyCompletionContext,
  type NeonConfigKeySpec,
} from "../domain/neonConfigSchema";
import {
  neonParameterCompletionContextAt,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
} from "../domain/netteDiContainer";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { NEON_MAX_COMPLETIONS } from "./neonCompletionLimits";
import type { NeonCompletionItem } from "./neonCompletionItems";
import {
  neonParameterCompletions,
  neonServiceReferenceCompletions,
  neonServiceSetupMethodCompletions,
} from "./netteNeonCompletionResolvers";
import {
  offsetAtEditorPosition,
  type NeonRequestContext,
  type NeonRuntimeDependencies,
} from "./neonIntelligenceRuntime";

export interface NeonCompletionDependencies extends NeonRuntimeDependencies {
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  searchClassNames(
    rootPath: string,
    prefix: string,
    maxResults: number,
  ): Promise<string[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
}

export async function provideNeonCompletions(
  context: NeonRequestContext<NeonCompletionDependencies>,
  source: string,
  position: EditorPosition,
): Promise<NeonCompletionItem[]> {
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
    return neonServiceSetupMethodCompletions(context, setupMethodCompletion);
  }

  const keyCompletion = neonConfigKeyCompletionContextAt(source, offset);

  if (keyCompletion) {
    const packageVersions = neonConfigKeyScopeRequiresComposerVersion(
      keyCompletion.scope,
    )
      ? await loadNettePackageVersions(context)
      : new Map();

    if (!isRequestedRootActive()) {
      return [];
    }

    return neonConfigKeyCompletions(source, keyCompletion, packageVersions);
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
}

function neonConfigKeyCompletions(
  source: string,
  completion: NeonConfigKeyCompletionContext,
  packageVersions: ReturnType<typeof netteComposerPackageVersionsFromLock>,
): NeonCompletionItem[] {
  const normalizedPrefix = completion.prefix.toLowerCase();
  const indentUnit = neonIndentUnitFromSource(source);

  return neonConfigKeySpecs(source, completion, packageVersions)
    .filter((spec) => spec.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, NEON_MAX_COMPLETIONS)
    .map((spec) => ({
      detail: spec.description,
      insertText: neonConfigKeyInsertText(spec, completion, source, indentUnit),
      kind: "parameter" as const,
      label: spec.name,
      replaceEnd: completion.span.end,
      replaceStart: completion.span.start,
    }));
}

function neonConfigKeySpecs(
  source: string,
  completion: NeonConfigKeyCompletionContext,
  packageVersions: ReturnType<typeof netteComposerPackageVersionsFromLock>,
): NeonConfigKeySpec[] {
  const specs = [
    ...compatibleNeonConfigKeySpecsForScope(completion.scope, packageVersions),
  ];

  if (completion.scope.kind !== "top-level") {
    return specs;
  }

  const knownNames = new Set(specs.map((spec) => spec.name.toLowerCase()));

  for (const name of neonExtensionNamesFromSource(source)) {
    if (knownNames.has(name.toLowerCase())) {
      continue;
    }

    knownNames.add(name.toLowerCase());
    specs.push({
      description: `Configuration of the ${name} extension`,
      name,
      valueKind: "section",
    });
  }

  return specs;
}

const NETTE_PACKAGE_VERSION_CACHE_TTL_MS = 5_000;
const packageVersionCaches = new WeakMap<
  object,
  Map<
    string,
    {
      expiresAt: number;
      versions: ReturnType<typeof netteComposerPackageVersionsFromLock>;
    }
  >
>();

async function loadNettePackageVersions(
  context: NeonRequestContext<NeonCompletionDependencies>,
): Promise<ReturnType<typeof netteComposerPackageVersionsFromLock>> {
  const cacheOwner = context.configCache;
  const cache = packageVersionCaches.get(cacheOwner) ?? new Map();
  packageVersionCaches.set(cacheOwner, cache);

  for (const cachedRoot of cache.keys()) {
    if (cachedRoot === context.requestedRoot) {
      continue;
    }

    cache.delete(cachedRoot);
  }

  const cached = cache.get(context.requestedRoot);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.versions;
  }

  let source = "";

  try {
    source = await context.deps.readFileContent(
      context.deps.joinPath(context.requestedRoot, "composer.lock"),
    );
  } catch {
    const versions = new Map<string, string>();

    if (context.isRequestedRootActive()) {
      cache.set(context.requestedRoot, {
        expiresAt: Date.now() + NETTE_PACKAGE_VERSION_CACHE_TTL_MS,
        versions,
      });
    }

    return versions;
  }

  if (!context.isRequestedRootActive()) {
    return new Map();
  }

  const versions = netteComposerPackageVersionsFromLock(source);
  cache.set(context.requestedRoot, {
    expiresAt: Date.now() + NETTE_PACKAGE_VERSION_CACHE_TTL_MS,
    versions,
  });
  return versions;
}

function neonConfigKeyInsertText(
  spec: NeonConfigKeySpec,
  completion: NeonConfigKeyCompletionContext,
  source: string,
  indentUnit: string,
): string {
  if (completion.followedByColon) {
    return spec.name;
  }

  if (spec.valueKind === "section") {
    const lineStart = source.lastIndexOf("\n", completion.span.start - 1) + 1;
    const currentIndent =
      source.slice(lineStart, completion.span.start).match(/^\s*/)?.[0] ?? "";
    return `${spec.name}:\n${currentIndent}${indentUnit}`;
  }

  return `${spec.name}: `;
}
