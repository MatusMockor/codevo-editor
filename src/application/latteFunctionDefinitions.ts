import {
  collectLatteMaskedRegions,
  innermostLatteExpressionContextAt,
} from "../domain/latteSyntax";
import { latteExpressionLexicalStateAtEnd } from "../domain/latteReceiverExpression";
import {
  openLatteRegistrationTarget,
  type LatteRegistrationNavigationContext,
} from "./latteFilterDefinitions";
import {
  latteFunctionDiscoveryContext,
  loadLatteFunctionRegistrations,
  type LatteFunctionRegistrationTarget,
} from "./latteFunctionDiscovery";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";

export interface LatteFunctionReference {
  name: string;
}

export interface LatteFunctionDefinitionContext
  extends LatteRegistrationNavigationContext {
  loadFunctionRegistrations(): Promise<LatteFunctionRegistrationTarget[]>;
}

const LATTE_FUNCTION_CALL = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const LATTE_BARE_TAG_FUNCTION_CALL = /^\{([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const EXCLUDED_CALL_PREFIX = /[|$>:\\A-Za-z0-9_]/;
const MAX_BARE_TAG_LOOKBEHIND = 256;

export function latteFunctionDefinitionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): LatteFunctionDefinitionContext {
  const discovery = latteFunctionDiscoveryContext(options, request);

  return {
    deps: request.deps,
    isRequestedRootActive: discovery.isRequestedRootActive,
    loadFunctionRegistrations: () => loadLatteFunctionRegistrations(discovery),
  };
}

export async function resolveLatteFunctionDefinition(
  context: LatteFunctionDefinitionContext,
  source: string,
  offset: number,
  reference: LatteFunctionReference | null = latteFunctionReferenceAt(
    source,
    offset,
  ),
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const registrations = await context.loadFunctionRegistrations();

  if (!context.isRequestedRootActive()) {
    return false;
  }

  const target = registrations.find(
    (registration) => registration.name === reference.name,
  );

  if (!target) {
    return false;
  }

  return openLatteRegistrationTarget(context, target);
}

export function latteFunctionReferenceAt(
  source: string,
  offset: number,
): LatteFunctionReference | null {
  const expressionReference = latteExpressionFunctionReferenceAt(source, offset);

  if (expressionReference) {
    return expressionReference;
  }

  return latteBareTagFunctionReferenceAt(source, offset);
}

function latteExpressionFunctionReferenceAt(
  source: string,
  offset: number,
): LatteFunctionReference | null {
  const context = innermostLatteExpressionContextAt(source, offset);

  if (!context) {
    return null;
  }

  const expressionStart = context.span.expressionStart;
  const expression = source.slice(expressionStart, context.span.contentEnd);
  const relativeOffset = offset - expressionStart;

  return functionCallReferenceInExpression(expression, relativeOffset);
}

function functionCallReferenceInExpression(
  expression: string,
  relativeOffset: number,
): LatteFunctionReference | null {
  for (const match of expression.matchAll(LATTE_FUNCTION_CALL)) {
    const name = match[1];

    if (!name || match.index === undefined) {
      continue;
    }

    const nameStart = match.index;
    const nameEnd = nameStart + name.length;

    if (relativeOffset < nameStart || relativeOffset > nameEnd) {
      continue;
    }

    const previous = expression[nameStart - 1] ?? "";

    if (previous && EXCLUDED_CALL_PREFIX.test(previous)) {
      continue;
    }

    if (latteExpressionLexicalStateAtEnd(expression.slice(0, nameStart)) !== "code") {
      continue;
    }

    return { name };
  }

  return null;
}

function latteBareTagFunctionReferenceAt(
  source: string,
  offset: number,
): LatteFunctionReference | null {
  const braceStart = bareTagOpenBraceBefore(source, offset);

  if (braceStart === null) {
    return null;
  }

  if (isInsideMaskedLatteRegion(source, offset)) {
    return null;
  }

  const match = LATTE_BARE_TAG_FUNCTION_CALL.exec(
    source.slice(braceStart, braceStart + MAX_BARE_TAG_LOOKBEHIND),
  );
  const name = match?.[1];

  if (!name) {
    return null;
  }

  const nameStart = braceStart + 1;
  const nameEnd = nameStart + name.length;

  if (offset < nameStart || offset > nameEnd) {
    return null;
  }

  return { name };
}

function bareTagOpenBraceBefore(source: string, offset: number): number | null {
  const lowerBound = Math.max(0, offset - MAX_BARE_TAG_LOOKBEHIND);

  for (let index = Math.min(offset, source.length) - 1; index >= lowerBound; index -= 1) {
    const character = source[index] ?? "";

    if (character === "{") {
      return index;
    }

    if (character === "}" || character === "\n") {
      return null;
    }
  }

  return null;
}

function isInsideMaskedLatteRegion(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source, offset).some(
    (region) => offset > region.start && offset < region.end,
  );
}
