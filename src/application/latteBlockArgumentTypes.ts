import {
  parseLatteBlockSyntax,
  type LatteBlockDefinition,
  type LatteBlockInclude,
  type LatteBlockIncludeArgument,
  type LatteBlockParameter,
  type LatteBlockSyntaxDocument,
} from "../domain/latteBlockSyntax";

export interface LatteBlockArgumentTypeResolution {
  /** When true, downstream sources must not supply this lexical variable. */
  blocksOuterScope: boolean;
  found: boolean;
  type: string | null;
}

export interface LatteBlockArgumentTypeContext {
  isRequestedRootActive(): boolean;
  resolveExpressionType(
    expression: string,
    includeOffset: number,
  ): Promise<string | null>;
}

export type LatteBlockExpressionTypeResolver = (
  expression: string,
  includeOffset: number,
) => Promise<string | null>;

interface ResolutionState {
  activeKeys: Set<string>;
  context: LatteBlockArgumentTypeContext;
  statesVisited: number;
  syntax: LatteBlockSyntaxDocument;
}

interface TypeEvidence {
  exhausted: boolean;
  participates: boolean;
  type: string | null;
}

const MAX_FORWARDING_DEPTH = 8;
const MAX_RESOLUTION_STATES = 2_000;
const VARIABLE_EXPRESSION = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/** Resolves a formal block argument from same-document include sites. */
export async function resolveLatteBlockArgumentType(
  source: string,
  offset: number,
  variableName: string,
  contextOrResolver:
    | LatteBlockArgumentTypeContext
    | LatteBlockExpressionTypeResolver,
  isRequestedRootActive: () => boolean = () => true,
): Promise<LatteBlockArgumentTypeResolution> {
  const context = blockArgumentTypeContext(
    contextOrResolver,
    isRequestedRootActive,
  );

  if (!context.isRequestedRootActive()) {
    return unresolvedResult();
  }

  const syntax = parseLatteBlockSyntax(source);
  const definition = innermostDefinitionAt(syntax, offset);

  if (!definition) {
    return unresolvedResult();
  }

  const normalizedName = variableName.replace(/^\$/, "");
  const parameter = definition.parameters.find(
    (candidate) => candidate.name === normalizedName,
  );

  if (!parameter) {
    return { blocksOuterScope: true, found: false, type: null };
  }

  const state: ResolutionState = {
    activeKeys: new Set(),
    context,
    statesVisited: 0,
    syntax,
  };
  const evidence = await resolveFormalParameter(
    state,
    definition,
    parameter,
    0,
  );

  if (!context.isRequestedRootActive()) {
    return unresolvedResult();
  }

  return {
    blocksOuterScope: true,
    found: true,
    type: evidence.participates ? evidence.type : null,
  };
}

function blockArgumentTypeContext(
  contextOrResolver:
    | LatteBlockArgumentTypeContext
    | LatteBlockExpressionTypeResolver,
  isRequestedRootActive: () => boolean,
): LatteBlockArgumentTypeContext {
  if (typeof contextOrResolver !== "function") {
    return contextOrResolver;
  }

  return {
    isRequestedRootActive,
    resolveExpressionType: contextOrResolver,
  };
}

function innermostDefinitionAt(
  syntax: LatteBlockSyntaxDocument,
  offset: number,
): LatteBlockDefinition | null {
  let innermost: LatteBlockDefinition | null = null;

  for (const definition of syntax.definitions) {
    if (definition.kind !== "define") {
      continue;
    }

    if (offset < definition.bodySpan.start || offset > definition.bodySpan.end) {
      continue;
    }

    if (!innermost || definition.bodySpan.start >= innermost.bodySpan.start) {
      innermost = definition;
    }
  }

  return innermost;
}

async function resolveFormalParameter(
  state: ResolutionState,
  definition: LatteBlockDefinition,
  parameter: LatteBlockParameter,
  depth: number,
): Promise<TypeEvidence> {
  const key = `${definition.tagSpan.start}:${parameter.name}`;

  if (state.activeKeys.has(key)) {
    return skippedEvidence();
  }

  if (depth > MAX_FORWARDING_DEPTH) {
    return exhaustedEvidence();
  }

  if (!consumeResolutionState(state)) {
    return exhaustedEvidence();
  }

  if (parameter.type) {
    return { exhausted: false, participates: true, type: parameter.type };
  }

  state.activeKeys.add(key);
  const callers = state.syntax.includes.filter(
    (include) => include.name === definition.name,
  );
  const evidence: TypeEvidence[] = [];

  if (callers.length === 0) {
    evidence.push(await resolveDefault(state, definition, parameter, depth));
  }

  for (const include of callers) {
    if (!consumeResolutionState(state)) {
      evidence.push(exhaustedEvidence());
      break;
    }

    if (!state.context.isRequestedRootActive()) {
      state.activeKeys.delete(key);
      return skippedEvidence();
    }

    evidence.push(
      await resolveCallerArgument(state, definition, parameter, include, depth),
    );
  }

  state.activeKeys.delete(key);
  return mergeEvidence(evidence);
}

async function resolveCallerArgument(
  state: ResolutionState,
  definition: LatteBlockDefinition,
  parameter: LatteBlockParameter,
  include: LatteBlockInclude,
  depth: number,
): Promise<TypeEvidence> {
  const argument = boundArgument(definition, parameter, include);

  if (!argument) {
    return resolveDefault(state, definition, parameter, depth);
  }

  return resolveExpressionEvidence(
    state,
    argument.value,
    argument.valueSpan.start,
    include.ownerDefinition,
    depth,
  );
}

function boundArgument(
  definition: LatteBlockDefinition,
  parameter: LatteBlockParameter,
  include: LatteBlockInclude,
): LatteBlockIncludeArgument | null {
  const parameterIndex = definition.parameters.indexOf(parameter);
  const positional = include.arguments.filter(
    (argument) => argument.kind === "positional",
  )[parameterIndex];

  if (positional && !isNullishArgument(positional)) {
    return positional;
  }

  return (
    include.arguments.find(
      (argument) =>
        argument.kind === "named" &&
        argument.name === parameter.name &&
        !isNullishArgument(argument),
    ) ?? null
  );
}

function isNullishArgument(argument: LatteBlockIncludeArgument): boolean {
  return argument.value.trim().toLowerCase() === "null";
}

async function resolveDefault(
  state: ResolutionState,
  definition: LatteBlockDefinition,
  parameter: LatteBlockParameter,
  depth: number,
): Promise<TypeEvidence> {
  if (!parameter.defaultValue || !parameter.defaultValueSpan) {
    return { exhausted: false, participates: true, type: null };
  }

  return resolveExpressionEvidence(
    state,
    parameter.defaultValue,
    parameter.defaultValueSpan.start,
    definition,
    depth,
  );
}

async function resolveExpressionEvidence(
  state: ResolutionState,
  expression: string,
  expressionOffset: number,
  ownerDefinition: LatteBlockDefinition | null,
  depth: number,
): Promise<TypeEvidence> {
  const forwardedName = VARIABLE_EXPRESSION.exec(expression.trim())?.[1] ?? null;

  if (forwardedName && ownerDefinition) {
    const ownerParameter = ownerDefinition.parameters.find(
      (parameter) => parameter.name === forwardedName,
    );

    if (ownerParameter) {
      return resolveFormalParameter(
        state,
        ownerDefinition,
        ownerParameter,
        depth + 1,
      );
    }
  }

  const type = await state.context.resolveExpressionType(
    expression,
    expressionOffset,
  );

  if (!state.context.isRequestedRootActive()) {
    return skippedEvidence();
  }

  return { exhausted: false, participates: true, type };
}

function mergeEvidence(evidence: readonly TypeEvidence[]): TypeEvidence {
  const participating = evidence.filter((item) => item.participates);

  if (participating.length === 0) {
    return skippedEvidence();
  }

  if (participating.some((item) => item.exhausted)) {
    return exhaustedEvidence();
  }

  const known = participating
    .map((item) => item.type)
    .filter((type): type is string => Boolean(type));

  if (known.length === 0) {
    return { exhausted: false, participates: true, type: null };
  }

  const first = known[0] ?? "";
  const normalizedFirst = normalizeType(first);

  if (!known.every((type) => normalizeType(type) === normalizedFirst)) {
    return { exhausted: false, participates: true, type: null };
  }

  return { exhausted: false, participates: true, type: first };
}

function normalizeType(type: string): string {
  return type.trim().replace(/^\\+/, "").toLowerCase();
}

function skippedEvidence(): TypeEvidence {
  return { exhausted: false, participates: false, type: null };
}

function exhaustedEvidence(): TypeEvidence {
  return { exhausted: true, participates: true, type: null };
}

function consumeResolutionState(state: ResolutionState): boolean {
  if (state.statesVisited >= MAX_RESOLUTION_STATES) {
    return false;
  }

  state.statesVisited += 1;
  return true;
}

function unresolvedResult(): LatteBlockArgumentTypeResolution {
  return { blocksOuterScope: false, found: false, type: null };
}
