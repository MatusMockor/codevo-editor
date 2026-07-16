import {
  latteStaticFileIncludes,
  type LatteIncludeNamedArgument,
  type LatteIncludeSourceSpan,
  type LatteStaticFileInclude,
} from "../domain/latteIncludes";

export interface NetteIncludedTemplateArgumentDependencies {
  enumerateTemplateRelativePaths(rootPath: string): Promise<readonly string[]>;
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
  resolveCallerVariableType(
    source: string,
    offset: number,
    variableName: string,
  ): Promise<string | null>;
  resolveTemplateCandidatePaths(
    reference: string,
    currentTemplateRelativePath: string,
  ): readonly string[];
}

export interface NetteIncludeArgumentProvenanceStep {
  expression: string;
  name: string;
  nameSpan: LatteIncludeSourceSpan;
  sourceTemplateRelativePath: string;
  targetTemplateRelativePath: string;
  valueSpan: LatteIncludeSourceSpan;
}

export interface NetteIncludedTemplateArgument {
  depth: number;
  expression: string;
  name: string;
  provenance: readonly NetteIncludeArgumentProvenanceStep[];
  sourceSpan: LatteIncludeSourceSpan;
  sourceTemplateRelativePath: string;
  targetSpan: LatteIncludeSourceSpan;
  targetTemplateRelativePath: string;
  type: string | null;
}

export interface NetteIncludedTemplateParsedFile {
  includes: readonly LatteStaticFileInclude[];
  relativePath: string;
  source: string | null;
}

export interface NetteIncludedTemplateGraphEdge {
  arguments: readonly LatteIncludeNamedArgument[];
  id: string;
  includePathSpan: LatteIncludeSourceSpan;
  sourceTemplateRelativePath: string;
  targetTemplateRelativePath: string;
}

export interface NetteIncludedTemplateArgumentGraph {
  cycleAnalysisOperations: number;
  cyclicEdgeIds: ReadonlySet<string>;
  edges: readonly NetteIncludedTemplateGraphEdge[];
  filesByPath: ReadonlyMap<string, NetteIncludedTemplateParsedFile>;
  incomingByTarget: ReadonlyMap<
    string,
    readonly NetteIncludedTemplateGraphEdge[]
  >;
  outgoingBySource: ReadonlyMap<
    string,
    readonly NetteIncludedTemplateGraphEdge[]
  >;
}

export interface NetteIncludedTemplateRootCacheEntry {
  generation: number;
  graph: NetteIncludedTemplateArgumentGraph;
  queryResults: Map<string, readonly NetteIncludedTemplateArgument[]>;
}

export type NetteIncludedTemplateArgumentCache = Record<
  string,
  NetteIncludedTemplateRootCacheEntry
>;

export interface NetteIncludedTemplateArgumentInFlight {
  graphs: Map<string, Promise<NetteIncludedTemplateArgumentGraph | null>>;
  queries: Map<string, Promise<readonly NetteIncludedTemplateArgument[]>>;
}

export interface NetteIncludedTemplateArgumentContext {
  cache: NetteIncludedTemplateArgumentCache;
  currentGeneration(): number;
  deps: NetteIncludedTemplateArgumentDependencies;
  generation: number;
  inFlight: NetteIncludedTemplateArgumentInFlight;
  isRequestedRootActive(): boolean;
  maxDepth: number;
  maxTraversalStates: number;
  requestedRoot: string;
}

interface ReverseTraversalState {
  activeTargetName: string;
  argument: LatteIncludeNamedArgument;
  downstream: readonly NetteIncludeArgumentProvenanceStep[];
  edge: NetteIncludedTemplateGraphEdge;
}

const DIRECT_VARIABLE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const INTEGER_LITERAL = /^[+-]?(?:0|[1-9][0-9]*)$/;
const FLOAT_LITERAL = /^[+-]?(?:(?:0|[1-9][0-9]*)\.[0-9]+|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** Returns all project-call-site bindings visible in the active target partial. */
export async function netteIncludedTemplateArguments(
  context: NetteIncludedTemplateArgumentContext,
  targetTemplateRelativePath: string,
): Promise<readonly NetteIncludedTemplateArgument[]> {
  if (!isCurrent(context) || !targetTemplateRelativePath || context.maxDepth < 1) {
    return [];
  }

  const graph = await loadGraph(context);

  if (!isCurrent(context) || !graph) {
    return [];
  }

  const rootCache = currentRootCache(context);

  if (!rootCache) {
    return [];
  }

  const cacheKey = targetQueryCacheKey(context, targetTemplateRelativePath);
  const cached = rootCache.queryResults.get(cacheKey);

  if (cached) {
    return cached;
  }

  const key = queryKey(context, targetTemplateRelativePath);
  const existing = context.inFlight.queries.get(key);

  if (existing) {
    return existing;
  }

  const query = collectTargetArguments(
    context,
    graph,
    targetTemplateRelativePath,
  ).finally(() => {
    if (context.inFlight.queries.get(key) === query) {
      context.inFlight.queries.delete(key);
    }
  });
  context.inFlight.queries.set(key, query);

  return query;
}

async function loadGraph(
  context: NetteIncludedTemplateArgumentContext,
): Promise<NetteIncludedTemplateArgumentGraph | null> {
  const cached = currentRootCache(context);

  if (cached) {
    return cached.graph;
  }

  const key = graphKey(context);
  const existing = context.inFlight.graphs.get(key);

  if (existing) {
    return existing;
  }

  const build = buildGraph(context).finally(() => {
    if (context.inFlight.graphs.get(key) === build) {
      context.inFlight.graphs.delete(key);
    }
  });
  context.inFlight.graphs.set(key, build);

  return build;
}

async function buildGraph(
  context: NetteIncludedTemplateArgumentContext,
): Promise<NetteIncludedTemplateArgumentGraph | null> {
  const enumerated = await context.deps.enumerateTemplateRelativePaths(
    context.requestedRoot,
  );

  if (!isCurrent(context)) {
    return null;
  }

  const relativePaths = Array.from(new Set(enumerated)).sort(compareText);
  const existingPaths = new Set(relativePaths);
  const filesByPath = new Map<string, NetteIncludedTemplateParsedFile>();

  for (const relativePath of relativePaths) {
    const source = await readTemplate(context, relativePath);

    if (!isCurrent(context)) {
      return null;
    }

    filesByPath.set(relativePath, {
      includes: source === null ? [] : latteStaticFileIncludes(source),
      relativePath,
      source,
    });
  }

  const edges: NetteIncludedTemplateGraphEdge[] = [];

  for (const relativePath of relativePaths) {
    const file = filesByPath.get(relativePath);

    if (!file) {
      continue;
    }

    for (const include of file.includes) {
      const target = firstExistingCandidate(
        context,
        include.path,
        relativePath,
        existingPaths,
      );

      if (!target) {
        continue;
      }

      edges.push({
        arguments: effectiveArguments(include.arguments),
        id: `${relativePath}\0${include.pathSpan.start}\0${target}`,
        includePathSpan: include.pathSpan,
        sourceTemplateRelativePath: relativePath,
        targetTemplateRelativePath: target,
      });
    }
  }

  const incomingByTarget = new Map<
    string,
    NetteIncludedTemplateGraphEdge[]
  >();
  const outgoingBySource = new Map<
    string,
    NetteIncludedTemplateGraphEdge[]
  >();

  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.targetTemplateRelativePath) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.targetTemplateRelativePath, incoming);
    const outgoing = outgoingBySource.get(edge.sourceTemplateRelativePath) ?? [];
    outgoing.push(edge);
    outgoingBySource.set(edge.sourceTemplateRelativePath, outgoing);
  }

  const cycleAnalysis = analyzeCyclicEdges(
    relativePaths,
    edges,
    incomingByTarget,
    outgoingBySource,
  );

  if (!isCurrent(context)) {
    return null;
  }

  const graph: NetteIncludedTemplateArgumentGraph = {
    cycleAnalysisOperations: cycleAnalysis.operations,
    cyclicEdgeIds: cycleAnalysis.edgeIds,
    edges,
    filesByPath,
    incomingByTarget,
    outgoingBySource,
  };
  context.cache[context.requestedRoot] = {
    generation: context.generation,
    graph,
    queryResults: new Map(),
  };

  return graph;
}

async function collectTargetArguments(
  context: NetteIncludedTemplateArgumentContext,
  graph: NetteIncludedTemplateArgumentGraph,
  targetPath: string,
): Promise<readonly NetteIncludedTemplateArgument[]> {
  const queue: ReverseTraversalState[] = [];
  const scheduled = new Set<string>();

  for (const edge of graph.incomingByTarget.get(targetPath) ?? []) {
    if (graph.cyclicEdgeIds.has(edge.id)) {
      continue;
    }

    for (const argument of edge.arguments) {
      scheduleState(
        queue,
        scheduled,
        {
          activeTargetName: argument.name,
          argument,
          downstream: [],
          edge,
        },
        context.maxTraversalStates,
      );
    }
  }

  const results: NetteIncludedTemplateArgument[] = [];
  const resultKeys = new Set<string>();
  let cursor = 0;

  while (cursor < queue.length) {
    if (!isCurrent(context)) {
      return [];
    }

    const state = queue[cursor];
    cursor += 1;

    if (!state || state.downstream.length >= context.maxDepth) {
      continue;
    }

    const step = provenanceStep(state.edge, state.argument);
    const provenance = [step, ...state.downstream];
    const variable = directVariableName(state.argument.value);

    if (!variable) {
      addResult(results, resultKeys, state, provenance, latteLiteralType(state.argument.value));
      continue;
    }

    const upstream = upstreamBindings(graph, state.edge.sourceTemplateRelativePath, variable);

    if (upstream.length === 0) {
      const type = await resolveLocalAliasType(context, graph, state, variable);

      if (!isCurrent(context)) {
        return [];
      }

      addResult(results, resultKeys, state, provenance, type);
      continue;
    }

    for (const binding of upstream) {
      if (graph.cyclicEdgeIds.has(binding.edge.id)) {
        continue;
      }

      scheduleState(
        queue,
        scheduled,
        {
          activeTargetName: state.activeTargetName,
          argument: binding.argument,
          downstream: provenance,
          edge: binding.edge,
        },
        context.maxTraversalStates,
      );
    }
  }

  if (!isCurrent(context)) {
    return [];
  }

  results.sort(compareResults);
  const rootCache = currentRootCache(context);

  if (!rootCache) {
    return [];
  }

  rootCache.queryResults.set(targetQueryCacheKey(context, targetPath), results);

  return results;
}

function scheduleState(
  queue: ReverseTraversalState[],
  scheduled: Set<string>,
  state: ReverseTraversalState,
  maxTraversalStates: number,
): void {
  if (scheduled.size >= maxTraversalStates) {
    return;
  }

  const key = `${state.activeTargetName}\0${state.edge.id}\0${state.argument.name}`;

  if (scheduled.has(key)) {
    return;
  }

  scheduled.add(key);
  queue.push(state);
}

function analyzeCyclicEdges(
  paths: readonly string[],
  edges: readonly NetteIncludedTemplateGraphEdge[],
  incomingByTarget: ReadonlyMap<
    string,
    readonly NetteIncludedTemplateGraphEdge[]
  >,
  outgoingBySource: ReadonlyMap<
    string,
    readonly NetteIncludedTemplateGraphEdge[]
  >,
): { edgeIds: ReadonlySet<string>; operations: number } {
  const finishOrder: string[] = [];
  const visited = new Set<string>();
  let operations = 0;

  for (const start of paths) {
    if (visited.has(start)) {
      continue;
    }

    visited.add(start);
    operations += 1;
    const stack: Array<{ edgeIndex: number; path: string }> = [
      { edgeIndex: 0, path: start },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      if (!frame) {
        break;
      }

      const outgoing = outgoingBySource.get(frame.path) ?? [];
      const edge = outgoing[frame.edgeIndex];

      if (!edge) {
        finishOrder.push(frame.path);
        stack.pop();
        continue;
      }

      frame.edgeIndex += 1;
      operations += 1;
      const target = edge.targetTemplateRelativePath;

      if (visited.has(target)) {
        continue;
      }

      visited.add(target);
      operations += 1;
      stack.push({ edgeIndex: 0, path: target });
    }
  }

  const componentByPath = new Map<string, number>();
  const componentSizes: number[] = [];

  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];

    if (!start || componentByPath.has(start)) {
      continue;
    }

    const component = componentSizes.length;
    const stack = [start];
    let size = 0;

    while (stack.length > 0) {
      const path = stack.pop();

      if (!path || componentByPath.has(path)) {
        continue;
      }

      componentByPath.set(path, component);
      operations += 1;
      size += 1;

      for (const edge of incomingByTarget.get(path) ?? []) {
        operations += 1;

        if (!componentByPath.has(edge.sourceTemplateRelativePath)) {
          stack.push(edge.sourceTemplateRelativePath);
        }
      }
    }

    componentSizes.push(size);
  }

  const edgeIds = new Set<string>();

  for (const edge of edges) {
    operations += 1;
    const sourceComponent = componentByPath.get(edge.sourceTemplateRelativePath);
    const targetComponent = componentByPath.get(edge.targetTemplateRelativePath);

    if (sourceComponent === undefined || sourceComponent !== targetComponent) {
      continue;
    }

    const componentSize = componentSizes[sourceComponent] ?? 0;

    if (
      componentSize > 1 ||
      edge.sourceTemplateRelativePath === edge.targetTemplateRelativePath
    ) {
      edgeIds.add(edge.id);
    }
  }

  return { edgeIds, operations };
}

function upstreamBindings(
  graph: NetteIncludedTemplateArgumentGraph,
  targetPath: string,
  variableName: string,
): Array<{
  argument: LatteIncludeNamedArgument;
  edge: NetteIncludedTemplateGraphEdge;
}> {
  const bindings: Array<{
    argument: LatteIncludeNamedArgument;
    edge: NetteIncludedTemplateGraphEdge;
  }> = [];

  for (const edge of graph.incomingByTarget.get(targetPath) ?? []) {
    const argument = edge.arguments.find((candidate) => candidate.name === variableName);

    if (argument) {
      bindings.push({ argument, edge });
    }
  }

  return bindings;
}

async function resolveLocalAliasType(
  context: NetteIncludedTemplateArgumentContext,
  graph: NetteIncludedTemplateArgumentGraph,
  state: ReverseTraversalState,
  variableName: string,
): Promise<string | null> {
  const source = graph.filesByPath.get(state.edge.sourceTemplateRelativePath)?.source;

  if (source === null || source === undefined) {
    return null;
  }

  return context.deps.resolveCallerVariableType(
    source,
    state.argument.valueSpan.start,
    variableName,
  );
}

function addResult(
  into: NetteIncludedTemplateArgument[],
  keys: Set<string>,
  state: ReverseTraversalState,
  provenance: readonly NetteIncludeArgumentProvenanceStep[],
  type: string | null,
): void {
  const origin = provenance[0];
  const target = provenance[provenance.length - 1];

  if (!origin || !target) {
    return;
  }

  const key = [
    state.activeTargetName,
    origin.sourceTemplateRelativePath,
    origin.valueSpan.start,
    origin.valueSpan.end,
  ].join("\0");

  if (keys.has(key)) {
    return;
  }

  keys.add(key);
  into.push({
    depth: provenance.length - 1,
    expression: origin.expression,
    name: state.activeTargetName,
    provenance,
    sourceSpan: origin.valueSpan,
    sourceTemplateRelativePath: origin.sourceTemplateRelativePath,
    targetSpan: target.nameSpan,
    targetTemplateRelativePath: target.targetTemplateRelativePath,
    type,
  });
}

function firstExistingCandidate(
  context: NetteIncludedTemplateArgumentContext,
  reference: string,
  callerPath: string,
  existingPaths: ReadonlySet<string>,
): string | null {
  for (const candidate of context.deps.resolveTemplateCandidatePaths(
    reference,
    callerPath,
  )) {
    if (existingPaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function effectiveArguments(
  argumentsInSourceOrder: readonly LatteIncludeNamedArgument[],
): LatteIncludeNamedArgument[] {
  const lastIndexByName = new Map<string, number>();

  for (let index = 0; index < argumentsInSourceOrder.length; index += 1) {
    const argument = argumentsInSourceOrder[index];

    if (argument) {
      lastIndexByName.set(argument.name, index);
    }
  }

  return argumentsInSourceOrder.filter(
    (argument, index) => lastIndexByName.get(argument.name) === index,
  );
}

async function readTemplate(
  context: NetteIncludedTemplateArgumentContext,
  relativePath: string,
): Promise<string | null> {
  try {
    return await context.deps.readFileContent(
      context.deps.joinPath(context.requestedRoot, relativePath),
    );
  } catch {
    return null;
  }
}

function provenanceStep(
  edge: NetteIncludedTemplateGraphEdge,
  argument: LatteIncludeNamedArgument,
): NetteIncludeArgumentProvenanceStep {
  return {
    expression: argument.value,
    name: argument.name,
    nameSpan: argument.nameSpan,
    sourceTemplateRelativePath: edge.sourceTemplateRelativePath,
    targetTemplateRelativePath: edge.targetTemplateRelativePath,
    valueSpan: argument.valueSpan,
  };
}

function directVariableName(expression: string): string | null {
  return DIRECT_VARIABLE.exec(expression.trim())?.[1] ?? null;
}

export function latteLiteralType(expression: string): string | null {
  const value = expression.trim();

  if (isQuotedLiteral(value)) {
    return "string";
  }

  if (INTEGER_LITERAL.test(value)) {
    return "int";
  }

  if (FLOAT_LITERAL.test(value)) {
    return "float";
  }

  if (/^(?:true|false)$/i.test(value)) {
    return "bool";
  }

  if (/^null$/i.test(value)) {
    return "null";
  }

  if (value === "[]") {
    return "array";
  }

  return null;
}

function isQuotedLiteral(value: string): boolean {
  if (value.length < 2) {
    return false;
  }

  const quote = value[0];

  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return false;
  }

  let escaped = false;

  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index] ?? "";

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === quote) {
      return false;
    }
  }

  return !escaped;
}

function compareResults(
  left: NetteIncludedTemplateArgument,
  right: NetteIncludedTemplateArgument,
): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.sourceTemplateRelativePath, right.sourceTemplateRelativePath) ||
    left.sourceSpan.start - right.sourceSpan.start ||
    compareText(provenanceKey(left.provenance), provenanceKey(right.provenance))
  );
}

function provenanceKey(
  provenance: readonly NetteIncludeArgumentProvenanceStep[],
): string {
  return provenance
    .map(
      (step) =>
        `${step.sourceTemplateRelativePath}:${step.valueSpan.start}:${step.name}`,
    )
    .join("\0");
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function currentRootCache(
  context: NetteIncludedTemplateArgumentContext,
): NetteIncludedTemplateRootCacheEntry | null {
  const cached = context.cache[context.requestedRoot];

  if (cached?.generation !== context.generation) {
    return null;
  }

  return cached;
}

function graphKey(context: NetteIncludedTemplateArgumentContext): string {
  return `${context.requestedRoot}\0${context.generation}`;
}

function queryKey(
  context: NetteIncludedTemplateArgumentContext,
  targetPath: string,
): string {
  return `${graphKey(context)}\0${targetQueryCacheKey(context, targetPath)}`;
}

function targetQueryCacheKey(
  context: NetteIncludedTemplateArgumentContext,
  targetPath: string,
): string {
  return `${targetPath}\0${context.maxDepth}\0${context.maxTraversalStates}`;
}

function isCurrent(context: NetteIncludedTemplateArgumentContext): boolean {
  return (
    context.isRequestedRootActive() &&
    context.currentGeneration() === context.generation
  );
}
