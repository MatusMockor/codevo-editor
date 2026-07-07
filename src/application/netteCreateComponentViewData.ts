import { netteCreateComponentFactoryContexts } from "../domain/netteComponents";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import type {
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "../domain/phpFrameworkProviders";

export interface NetteCreateComponentTypeResolver {
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
}

export interface NetteFactoryCandidateViewNameContext {
  action: string;
  deps: NetteCreateComponentTypeResolver & {
    joinPath(rootPath: string, relativePath: string): string;
    readFileContent(path: string): Promise<string>;
  };
  isRequestedRootActive(): boolean;
  requestedRoot: string;
  templateRelativePath: string;
}

interface PhpMethodBodyRange {
  bodyEnd: number;
  bodyStart: number;
}

const LATTE_TEMPLATE_EXTENSION = ".latte";

/**
 * The PHP classes that may own a Nette template: first the presenter candidates,
 * then colocated component/control candidates. Kept here as an application-level
 * resolver because callers need the same ownership rule for navigation,
 * completion and view-data mapping.
 */
export function componentOwnerCandidatePathsForTemplate(
  templateRelativePath: string,
): string[] {
  return Array.from(new Set([
    ...presenterCandidatePathsForTemplate(templateRelativePath),
    ...componentClassCandidatePathsForTemplate(templateRelativePath),
  ]));
}

/**
 * Some legacy Nette projects keep a component template under a presenter's
 * template tree instead of next to `SomethingControl.php`. PhpStorm follows the
 * `createComponentSomething(): SomethingControl` factory and still gives that
 * template the control's view-data. This resolver stays conservative: only
 * factories whose component name is named by the active template path and whose
 * control type looks like `*Control` contribute candidate owners.
 */
export async function factoryDerivedLatteCandidateViewNames(
  context: NetteFactoryCandidateViewNameContext,
): Promise<string[]> {
  const {
    action,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  } = context;
  const componentNames = componentNameCandidatesForTemplate(templateRelativePath);

  if (componentNames.size === 0) {
    return [];
  }

  const names = new Set<string>();

  for (const relativePath of componentOwnerCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return [];
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const factory of netteCreateComponentFactoryContexts(content)) {
      if (!componentNames.has(factory.componentName)) {
        continue;
      }

      const owner = controlViewOwnerFromFactory(content, factory.controlClass, deps);

      if (!owner) {
        continue;
      }

      names.add(`${owner}:${action}`);
      names.add(`${owner}:*`);
      names.add(`${owner}:default`);
    }
  }

  return Array.from(names);
}

/**
 * Extracts `$control->template->foo = ...` variables from createComponent
 * factories. The caller resolves and caches source discovery; this module owns
 * the Nette-specific parsing so the Latte hook does not grow framework rules.
 */
export function netteCreateComponentViewDataEntryFromSource(
  deps: NetteCreateComponentTypeResolver,
  source: string,
): PhpFrameworkViewDataEntry {
  const bindingsByView = new Map<string, Map<string, PhpFrameworkViewDataVariable>>();

  for (const factory of netteCreateComponentFactoryContexts(source)) {
    const controlClass = factory.controlClass
      ? (deps.resolveDeclaredType(source, factory.controlClass) ??
        factory.controlClass)
      : null;
    const viewOwner = componentViewOwnerNameFromType(controlClass);

    if (!viewOwner) {
      continue;
    }

    const range = phpMethodBodyRange(source, factory.methodName, factory.nameEnd);

    if (!range) {
      continue;
    }

    const variables = componentTemplateVariablesFromFactoryBody(
      source,
      range,
      controlClass,
    );

    if (variables.length === 0) {
      continue;
    }

    const viewName = `${viewOwner}:default`;
    const existing = bindingsByView.get(viewName) ?? new Map();

    for (const variable of variables) {
      existing.set(variable.name, variable);
    }

    bindingsByView.set(viewName, existing);
  }

  return {
    bindings: Array.from(bindingsByView.entries()).map(
      ([viewName, variables]) => ({
        variables: Array.from(variables.values()),
        viewName,
      }),
    ),
    source,
  };
}

export function componentViewOwnerNameFromType(typeName: string | null): string | null {
  const shortName = shortTypeName(typeName);

  if (!shortName) {
    return null;
  }

  for (const suffix of ["Control", "Component", "Widget"]) {
    if (shortName.endsWith(suffix) && shortName.length > suffix.length) {
      return shortName.slice(0, -suffix.length);
    }
  }

  return null;
}

export function phpTypeNamesEqual(left: string, right: string): boolean {
  return normalizePhpTypeName(left) === normalizePhpTypeName(right);
}

function controlViewOwnerFromFactory(
  source: string,
  typeHint: string | null,
  deps: NetteCreateComponentTypeResolver,
): string | null {
  const resolved = deps.resolveDeclaredType(source, typeHint) ?? typeHint;

  return componentViewOwnerNameFromType(resolved);
}

function componentTemplateVariablesFromFactoryBody(
  source: string,
  range: PhpMethodBodyRange,
  controlClass: string | null,
): PhpFrameworkViewDataVariable[] {
  const body = source.slice(range.bodyStart, range.bodyEnd);
  const targetVariables = componentFactoryTargetVariables(body, controlClass);

  if (targetVariables.size === 0) {
    return [];
  }

  const variables: PhpFrameworkViewDataVariable[] = [];
  const assignment =
    /\$([A-Za-z_][A-Za-z0-9_]*)\s*->\s*template\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])/g;

  for (const match of body.matchAll(assignment)) {
    const receiver = match[1] ?? "";
    const name = match[2] ?? "";

    if (!targetVariables.has(receiver) || !name) {
      continue;
    }

    const rawExpressionStart =
      range.bodyStart + (match.index ?? 0) + match[0].length;
    const expressionStart = skipPhpWhitespace(source, rawExpressionStart);
    const expressionEnd = phpStatementExpressionEnd(source, expressionStart);
    const expression = source.slice(expressionStart, expressionEnd).trim();

    if (expression.length === 0) {
      continue;
    }

    variables.push({
      detail: "createComponent factory",
      name: `$${name}`,
      typeHint: factoryAssignmentTypeHint(
        source,
        range.bodyStart,
        expressionStart,
        expression,
      ),
      valueExpression: expression,
      valueOffset: expressionStart,
    });
  }

  return variables;
}

function componentFactoryTargetVariables(
  body: string,
  controlClass: string | null,
): Set<string> {
  const variables = new Set<string>();
  const returnedVariable = /\breturn\s+\$([A-Za-z_][A-Za-z0-9_]*)\s*;/g;

  for (const match of body.matchAll(returnedVariable)) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }

  if (!controlClass) {
    return variables;
  }

  const assignedNew =
    /\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/g;

  for (const match of body.matchAll(assignedNew)) {
    const variableName = match[1] ?? "";
    const className = match[2] ?? "";

    if (variableName && phpTypeNamesEqual(className, controlClass)) {
      variables.add(variableName);
    }
  }

  return variables;
}

function factoryAssignmentTypeHint(
  source: string,
  bodyStart: number,
  expressionStart: number,
  expression: string,
): string | null {
  const newClass = /^\s*new\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/.exec(expression);

  if (newClass?.[1]) {
    return newClass[1];
  }

  const variable = /^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(expression);

  if (!variable?.[1]) {
    return null;
  }

  return localPhpVariableTypeBefore(
    source.slice(bodyStart, expressionStart),
    variable[1],
  );
}

function localPhpVariableTypeBefore(before: string, variableName: string): string | null {
  const escaped = escapeRegExp(variableName);
  const docblock = new RegExp(
    String.raw`@var\s+([\\A-Za-z_][A-Za-z0-9_\\]*(?:\[\])?)\s+\$${escaped}\b`,
    "g",
  );
  let resolved: string | null = null;

  for (const match of before.matchAll(docblock)) {
    resolved = match[1] ?? null;
  }

  if (resolved) {
    return resolved;
  }

  const assignedNew = new RegExp(
    String.raw`\$${escaped}\s*=\s*new\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b`,
    "g",
  );

  for (const match of before.matchAll(assignedNew)) {
    resolved = match[1] ?? null;
  }

  return resolved;
}

function phpMethodBodyRange(
  source: string,
  methodName: string,
  afterOffset: number,
): PhpMethodBodyRange | null {
  const openBrace = source.indexOf("{", afterOffset);
  const semicolon = source.indexOf(";", afterOffset);

  if (openBrace < 0 || (semicolon >= 0 && semicolon < openBrace)) {
    return null;
  }

  const bodyEnd = matchingPhpBracketOffset(source, openBrace, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  const methodPattern = new RegExp(`\\bfunction\\s+&?\\s*${escapeRegExp(methodName)}\\b`);
  const signatureStart = source.lastIndexOf("function", afterOffset);

  if (
    signatureStart < 0 ||
    !methodPattern.test(source.slice(signatureStart, openBrace))
  ) {
    return null;
  }

  return { bodyEnd, bodyStart: openBrace + 1 };
}

function componentNameCandidatesForTemplate(
  templateRelativePath: string,
): Set<string> {
  const segments = templateRelativePath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";
  const baseName = fileName.endsWith(LATTE_TEMPLATE_EXTENSION)
    ? fileName.slice(0, -LATTE_TEMPLATE_EXTENSION.length)
    : fileName;
  const candidates = new Set<string>();

  addComponentNameCandidate(candidates, baseName);

  const parent = segments[segments.length - 2] ?? "";

  if (isGenericComponentTemplateName(baseName)) {
    addComponentNameCandidate(candidates, parent);
  }

  if (parent === "templates") {
    addComponentNameCandidate(candidates, segments[segments.length - 3] ?? "");
  }

  const componentsIndex = segments.findIndex((segment) => segment === "Components");

  if (componentsIndex >= 0) {
    addComponentNameCandidate(candidates, segments[componentsIndex + 1] ?? "");
  }

  return candidates;
}

function addComponentNameCandidate(
  candidates: Set<string>,
  segment: string,
): void {
  const name = componentNameFromTemplateSegment(segment);

  if (name) {
    candidates.add(name);
  }
}

function componentNameFromTemplateSegment(segment: string): string | null {
  const cleaned = segment.replace(/\.[^.]+$/, "").replace(/Control$/, "");

  if (cleaned.length === 0 || isGenericComponentTemplateName(cleaned)) {
    return null;
  }

  const normalized = cleaned
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
  const candidate = normalized.charAt(0).toLowerCase() + normalized.slice(1);

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : null;
}

function isGenericComponentTemplateName(name: string): boolean {
  return name === "default" || name === "template";
}

function skipPhpWhitespace(source: string, offset: number): number {
  let index = offset;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function phpStatementExpressionEnd(source: string, expressionStart: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = expressionStart; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === ";" && depth === 0) {
      return index;
    }
  }

  return source.length;
}

function matchingPhpBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  if (source[openOffset] !== open) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhpTypeName(typeName: string): string {
  return typeName.trim().replace(/^\\+/, "").toLowerCase();
}

function shortTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const normalized = typeName.replace(/^\?/, "").replace(/^\\+/, "");
  const parts = normalized.split("\\").filter(Boolean);

  return parts[parts.length - 1] ?? normalized;
}
