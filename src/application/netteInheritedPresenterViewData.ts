import {
  netteViewDataSourceFactsFromSource,
  type NetteViewDataMethodFacts,
  type NetteViewDataSourceFacts,
} from "../domain/netteViewData";
import type {
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "../domain/phpFrameworkProviders";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import { presenterCandidatePathsForTemplate } from "../domain/nettePathResolution";
import { maskPhpStringsAndComments } from "../domain/phpReceiverExpressions";

export interface NetteInheritedPresenterViewDataEntry
  extends PhpFrameworkViewDataEntry {
  sourcePath: string;
}

export interface NetteInheritedPresenterSource {
  path: string;
  source: string;
}

export interface NetteInheritedPresenterViewDataDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
  readPhpClassSource?(
    className: string,
  ): Promise<NetteInheritedPresenterSource | null>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  sourceFacts?(source: string): NetteViewDataSourceFacts;
}

export interface NetteInheritedPresenterViewDataCacheEntry {
  entries: NetteInheritedPresenterViewDataEntry[];
  expiresAt: number;
}

export type NetteInheritedPresenterViewDataCache = Record<
  string,
  NetteInheritedPresenterViewDataCacheEntry
>;

export type NetteInheritedPresenterViewDataInFlight = Map<
  string,
  Promise<NetteInheritedPresenterViewDataEntry[]>
>;

export interface NetteInheritedPresenterViewDataContext {
  cache: NetteInheritedPresenterViewDataCache;
  deps: NetteInheritedPresenterViewDataDependencies;
  inFlight: NetteInheritedPresenterViewDataInFlight;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
  templateRelativePath: string;
  ttlMs: number;
}

interface PresenterLevel extends NetteInheritedPresenterSource {
  className: string;
  facts: NetteViewDataSourceFacts;
}

interface ResolvedPresenterSource extends NetteInheritedPresenterSource {
  className: string;
}

interface VariableExecution {
  level: PresenterLevel;
  method: NetteViewDataMethodFacts;
  variable: PhpFrameworkViewDataVariable;
}

const MAX_ANCESTOR_DEPTH = 5;

/**
 * Loads view data contributed by the active template's concrete presenter
 * lifecycle, applying PHP override and explicit parent-call dispatch.
 */
export async function loadNetteInheritedPresenterViewData(
  context: NetteInheritedPresenterViewDataContext,
): Promise<NetteInheritedPresenterViewDataEntry[]> {
  const key = inheritedPresenterCacheKey(
    context.requestedRoot,
    context.templateRelativePath,
  );

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const cached = context.cache[key];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  const existing = context.inFlight.get(key);

  if (existing) {
    if (!context.isRequestedRootActive()) {
      return [];
    }

    const entries = await existing;
    return context.isRequestedRootActive() ? entries : [];
  }

  const load = scanInheritedPresenterViewData(context).finally(() => {
    if (context.inFlight.get(key) === load) {
      context.inFlight.delete(key);
    }
  });

  context.inFlight.set(key, load);
  return load;
}

export function inheritedPresenterCacheKey(
  requestedRoot: string,
  templateRelativePath: string,
): string {
  return `${requestedRoot}\u0000${templateRelativePath}`;
}

async function scanInheritedPresenterViewData(
  context: NetteInheritedPresenterViewDataContext,
): Promise<NetteInheritedPresenterViewDataEntry[]> {
  const concrete = await resolveConcretePresenter(context);

  if (!context.isRequestedRootActive() || !concrete) {
    return [];
  }

  const levels = await presenterLevels(context, concrete);

  if (!context.isRequestedRootActive() || levels.length === 0) {
    return [];
  }

  const concreteOwner = levels[0]?.facts.owner;

  if (!concreteOwner || concreteOwner.kind !== "presenter") {
    return [];
  }

  const action = activeAction(context.templateRelativePath);
  const lifecycleNames = [
    "startup",
    `action${upperFirst(action)}`,
    "beforeRender",
    `render${upperFirst(action)}`,
  ];
  const winners = new Map<string, VariableExecution>();

  for (const methodName of lifecycleNames) {
    for (const execution of dispatchedVariableExecutions(levels, methodName)) {
      winners.delete(execution.variable.name);
      winners.set(execution.variable.name, execution);
    }
  }

  const entries = Array.from(winners.values()).map(
    ({ level, method, variable }) => ({
      bindings: [
        {
          variables: [variable],
          viewName: `${concreteOwner.name}:${methodViewAction(method, action)}`,
        },
      ],
      source: level.source,
      sourcePath: level.path,
    }),
  );

  if (!context.isRequestedRootActive()) {
    return [];
  }

  context.cache[
    inheritedPresenterCacheKey(
      context.requestedRoot,
      context.templateRelativePath,
    )
  ] = { entries, expiresAt: Date.now() + context.ttlMs };

  return entries;
}

async function resolveConcretePresenter(
  context: NetteInheritedPresenterViewDataContext,
): Promise<ResolvedPresenterSource | null> {
  for (const relativePath of presenterCandidatePathsForTemplate(
    context.templateRelativePath,
  )) {
    if (!context.isRequestedRootActive()) {
      return null;
    }

    const path = context.deps.joinPath(context.requestedRoot, relativePath);

    try {
      const source = await context.deps.readFileContent(path);

      if (!context.isRequestedRootActive()) {
        return null;
      }

      const facts = factsFromSource(context.deps, source);

      if (facts.owner?.kind === "presenter") {
        const declaredName = `${facts.owner.name}Presenter`;
        const className = normalizeClassName(
          context.deps.resolveDeclaredType(source, declaredName) ?? declaredName,
        );

        return {
          className,
          path,
          source,
        };
      }
    } catch {
      if (!context.isRequestedRootActive()) {
        return null;
      }
    }
  }

  return null;
}

async function presenterLevels(
  context: NetteInheritedPresenterViewDataContext,
  concrete: ResolvedPresenterSource,
): Promise<PresenterLevel[]> {
  const readPhpClassSource = context.deps.readPhpClassSource;
  const levels: PresenterLevel[] = [];
  const visitedClasses = new Set<string>();
  const visitedPaths = new Set<string>();
  let current: ResolvedPresenterSource | null = concrete;

  visitedClasses.add(normalizeClassName(concrete.className).toLowerCase());

  for (let depth = 0; current && depth <= MAX_ANCESTOR_DEPTH; depth += 1) {
    if (visitedPaths.has(current.path)) {
      break;
    }

    const facts = factsFromSource(context.deps, current.source);

    if (facts.owner?.kind !== "presenter") {
      break;
    }

    visitedPaths.add(current.path);
    levels.push({ ...current, facts });

    if (!readPhpClassSource) {
      break;
    }

    if (depth === MAX_ANCESTOR_DEPTH) {
      break;
    }

    const parentReference = parentReferenceForClass(
      current.source,
      current.className,
    );

    if (!parentReference) {
      break;
    }

    const resolved =
      context.deps.resolveDeclaredType(current.source, parentReference) ??
      parentReference;
    const className = normalizeClassName(resolved);
    const classKey = className.toLowerCase();

    if (!className || visitedClasses.has(classKey)) {
      break;
    }

    visitedClasses.add(classKey);
    const parentSource = await readPhpClassSource(className);
    current = parentSource ? { ...parentSource, className } : null;

    if (!context.isRequestedRootActive()) {
      return [];
    }
  }

  return levels;
}

function dispatchedVariableExecutions(
  levels: readonly PresenterLevel[],
  methodName: string,
): VariableExecution[] {
  const firstLevel = levels.findIndex((level) =>
    level.facts.methods.some(
      (method) => method.methodName.toLowerCase() === methodName.toLowerCase(),
    ),
  );

  return firstLevel < 0
    ? []
    : executeMethod(levels, firstLevel, methodName);
}

function executeMethod(
  levels: readonly PresenterLevel[],
  levelIndex: number,
  methodName: string,
): VariableExecution[] {
  const level = levels[levelIndex];

  if (!level) {
    return [];
  }

  const method = level.facts.methods.find(
    (candidate) => candidate.methodName.toLowerCase() === methodName.toLowerCase(),
  );

  if (!method) {
    const nextLevel = levels.findIndex(
      (candidate, index) =>
        index > levelIndex &&
        candidate.facts.methods.some(
          (candidateMethod) =>
            candidateMethod.methodName.toLowerCase() === methodName.toLowerCase(),
        ),
    );
    return nextLevel < 0 ? [] : executeMethod(levels, nextLevel, methodName);
  }

  const events: Array<
    | { kind: "parent"; offset: number }
    | { kind: "variable"; offset: number; variable: PhpFrameworkViewDataVariable }
  > = method.variables.map((variable) => ({
    kind: "variable",
    offset: variable.valueOffset ?? Number.NEGATIVE_INFINITY,
    variable,
  }));

  if (method.callsParent && method.parentCallOffset !== null) {
    events.push({ kind: "parent", offset: method.parentCallOffset });
  }

  events.sort((left, right) => left.offset - right.offset);

  const executions: VariableExecution[] = [];

  for (const event of events) {
    if (event.kind === "variable") {
      executions.push({ level, method, variable: event.variable });
      continue;
    }

    executions.push(...executeMethod(levels, levelIndex + 1, methodName));
  }

  return executions;
}

function parentReferenceForClass(
  source: string,
  className: string,
): string | null {
  const shortName = shortClassName(className);
  const declaration = parsePhpClassStructure(source, shortName).typeDeclaration;

  if (!declaration) {
    return null;
  }

  const headerSource = maskPhpStringsAndComments(source).slice(
    0,
    declaration.bodyStartOffset,
  );
  const classHeader = new RegExp(
    `\\bclass\\s+${escapeRegExp(shortName)}\\b([^{};]*)$`,
  ).exec(headerSource)?.[1];

  if (classHeader === undefined) {
    return null;
  }

  return (
    /\bextends\s+(\\?[A-Za-z_][\\A-Za-z0-9_]*)/.exec(classHeader)?.[1] ??
    null
  );
}

function shortClassName(className: string): string {
  const segments = normalizeClassName(className).split("\\");
  return segments[segments.length - 1] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function factsFromSource(
  deps: NetteInheritedPresenterViewDataDependencies,
  source: string,
): NetteViewDataSourceFacts {
  return deps.sourceFacts?.(source) ?? netteViewDataSourceFactsFromSource(source);
}

function methodViewAction(
  method: NetteViewDataMethodFacts,
  activeTemplateAction: string,
): string {
  return method.methodName === "startup" || method.methodName === "beforeRender"
    ? "*"
    : activeTemplateAction;
}

function activeAction(templateRelativePath: string): string {
  const fileName = templateRelativePath.split("/").pop() ?? "";
  const basename = fileName.endsWith(".latte")
    ? fileName.slice(0, -".latte".length)
    : fileName;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && dot < basename.length - 1
    ? basename.slice(dot + 1)
    : basename || "default";
}

function normalizeClassName(className: string): string {
  return className.trim().replace(/^\\+/, "");
}

function upperFirst(value: string): string {
  return value.length > 0 ? value[0]?.toUpperCase() + value.slice(1) : value;
}
