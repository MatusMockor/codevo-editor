import type { PhpMethodCompletion } from "./phpMethodCompletions";
import { firstPhpDocTypeToken } from "./phpDocTemplates";

const laravelEloquentStaticBuilderMethods = new Set([
  "chunk",
  "count",
  "doesnthave",
  "doesntexist",
  "exists",
  "forcedelete",
  "groupby",
  "has",
  "having",
  "insert",
  "join",
  "latest",
  "leftjoin",
  "limit",
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "offset",
  "oldest",
  "onlytrashed",
  "orwhere",
  "orwherebelongsto",
  "orwherebetween",
  "orwheredate",
  "orwheredoesnthave",
  "orwherehas",
  "orwherein",
  "orwherenotin",
  "orwherenotnull",
  "orwherenull",
  "orderby",
  "on",
  "onwriteconnection",
  "paginate",
  "pluck",
  "query",
  "restore",
  "rightjoin",
  "select",
  "simplepaginate",
  "skip",
  "take",
  "updateorcreate",
  "wherebetween",
  "where",
  "wherebelongsto",
  "wheredoesnthave",
  "wheredate",
  "whereday",
  "wherehas",
  "wherein",
  "wherejsoncontains",
  "wherekey",
  "wherekeynot",
  "wheremonth",
  "wherenotbetween",
  "wherenotin",
  "wherenotnull",
  "wherenull",
  "whererelation",
  "wheretime",
  "whereyear",
  "with",
  "withcount",
  "withexists",
  "withrelations",
  "withtrashed",
  "without",
  "withouttrashed",
]);

const laravelEloquentBuilderFluentMethods = new Set([
  "chunk",
  "count",
  "doesnthave",
  "doesntexist",
  "exists",
  "forcedelete",
  "groupby",
  "has",
  "having",
  "insert",
  "join",
  "latest",
  "leftjoin",
  "limit",
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "offset",
  "oldest",
  "onlytrashed",
  "orwhere",
  "orwherebelongsto",
  "orwherebetween",
  "orwheredate",
  "orwheredoesnthave",
  "orwherehas",
  "orwherein",
  "orwherenotin",
  "orwherenotnull",
  "orwherenull",
  "orderby",
  "on",
  "onwriteconnection",
  "paginate",
  "pluck",
  "restore",
  "rightjoin",
  "select",
  "simplepaginate",
  "skip",
  "take",
  "tap",
  "updateorcreate",
  "unless",
  "when",
  "where",
  "wherebelongsto",
  "wherebetween",
  "wheredoesnthave",
  "wheredate",
  "whereday",
  "wherehas",
  "wherein",
  "wherejsoncontains",
  "wherekey",
  "wherekeynot",
  "wheremonth",
  "wherenotbetween",
  "wherenotin",
  "wherenotnull",
  "wherenull",
  "whererelation",
  "wheretime",
  "whereyear",
  "with",
  "withcount",
  "withexists",
  "withrelations",
  "withtrashed",
  "without",
  "withouttrashed",
]);

const laravelEloquentBuilderTerminalModelMethods = new Set([
  "create",
  "find",
  "findorfail",
  "first",
  "firstor",
  "firstorcreate",
  "firstorfail",
  "sole",
  "updateorcreate",
]);

const laravelEloquentBuilderCollectionMethods = new Set([
  "all",
  "cursor",
  "get",
]);

const laravelEloquentModelBuilderFactoryMethods = new Set([
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "on",
  "onwriteconnection",
  "query",
]);

const laravelCollectionTerminalModelMethods = new Set([
  "find",
  "first",
  "firstwhere",
  "last",
  "sole",
]);

const laravelCollectionFluentMethods = new Set([
  "filter",
  "forpage",
  "keyby",
  "only",
  "reject",
  "reverse",
  "skip",
  "slice",
  "sort",
  "sortby",
  "sortbydesc",
  "take",
  "unique",
  "values",
  "where",
  "wherebetween",
  "wherein",
  "whereinstanceof",
  "wherenotin",
  "wherenotnull",
  "wherenull",
]);

export function isLaravelEloquentStaticBuilderMethod(methodName: string): boolean {
  return laravelEloquentStaticBuilderMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderFluentMethod(methodName: string): boolean {
  return laravelEloquentBuilderFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderTerminalModelMethod(
  methodName: string,
): boolean {
  return laravelEloquentBuilderTerminalModelMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderCollectionMethod(
  methodName: string,
): boolean {
  return laravelEloquentBuilderCollectionMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentModelBuilderFactoryMethod(
  methodName: string,
): boolean {
  return laravelEloquentModelBuilderFactoryMethods.has(methodName.toLowerCase());
}

export function isLaravelCollectionTerminalModelMethod(
  methodName: string,
): boolean {
  return laravelCollectionTerminalModelMethods.has(methodName.toLowerCase());
}

export function isLaravelCollectionFluentMethod(methodName: string): boolean {
  return laravelCollectionFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderMethodName(methodName: string): boolean {
  return (
    isLaravelEloquentStaticBuilderMethod(methodName) ||
    isLaravelEloquentBuilderFluentMethod(methodName) ||
    isLaravelEloquentBuilderTerminalModelMethod(methodName) ||
    isLaravelEloquentBuilderCollectionMethod(methodName)
  );
}

export function phpLaravelLocalScopeCompletionsFromMethods(
  methods: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return dedupePhpMembers(
    methods.flatMap((method) => {
      if (method.kind === "property" || method.isStatic) {
        return [];
      }

      const scopeName = laravelLocalScopeName(method.name);

      if (!scopeName) {
        return [];
      }

      return [
        {
          declaringClassName: method.declaringClassName,
          name: scopeName,
          parameters: splitPhpParameterList(method.parameters).slice(1).join(", "),
          returnType:
            method.returnType === "void" || method.returnType === "never"
              ? "Illuminate\\Database\\Eloquent\\Builder"
              : method.returnType,
        },
      ];
    }),
  );
}

export function phpLaravelStaticLocalScopeCompletionsFromMethods(
  methods: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return phpLaravelLocalScopeCompletionsFromMethods(methods).map((method) => ({
    ...method,
    isStatic: true,
  }));
}

export function phpLaravelModelAttributeCompletionsFromSource(
  source: string,
  declaringClassName: string,
): PhpMethodCompletion[] {
  const attributes = new Map<string, string | null>();

  for (const attribute of phpLaravelFillableAttributes(source)) {
    attributes.set(attribute, "mixed");
  }

  for (const attribute of phpLaravelAppendedAttributes(source)) {
    attributes.set(attribute, "mixed");
  }

  for (const [attribute, returnType] of phpLaravelCastAttributes(source)) {
    attributes.set(attribute, returnType);
  }

  for (const [attribute, returnType] of phpLaravelAccessorAttributes(source)) {
    attributes.set(attribute, returnType);
  }

  return Array.from(attributes, ([name, returnType]) => ({
    declaringClassName,
    kind: "property" as const,
    name,
    parameters: "",
    returnType,
  }));
}

function laravelLocalScopeName(methodName: string): string | null {
  const match = /^scope([A-Z][A-Za-z0-9_]*)$/.exec(methodName);
  const scopeName = match?.[1];

  if (!scopeName) {
    return null;
  }

  return `${scopeName[0]?.toLowerCase() ?? ""}${scopeName.slice(1)}`;
}

function phpLaravelFillableAttributes(source: string): string[] {
  return phpArrayAssignmentBodies(source, "fillable").flatMap((body) =>
    splitPhpParameterList(body)
      .map((item) => phpStringLiteralValue(item))
      .filter(isPhpAttributeName),
  );
}

function phpLaravelAppendedAttributes(source: string): string[] {
  return phpArrayAssignmentBodies(source, "appends").flatMap((body) =>
    splitPhpParameterList(body)
      .map((item) => phpStringLiteralValue(item))
      .filter(isPhpAttributeName),
  );
}

function phpLaravelCastAttributes(source: string): Array<[string, string | null]> {
  return phpArrayAssignmentBodies(source, "casts").flatMap((body) =>
    splitPhpParameterList(body).flatMap((item) => {
      const arrowIndex = topLevelArrayArrowIndex(item);

      if (arrowIndex < 0) {
        return [];
      }

      const attribute = phpStringLiteralValue(item.slice(0, arrowIndex));

      if (!isPhpAttributeName(attribute)) {
        return [];
      }

      return [
        [
          attribute,
          phpLaravelCastReturnType(item.slice(arrowIndex + 2)),
        ] satisfies [string, string | null],
      ];
    }),
  );
}

function phpLaravelAccessorAttributes(
  source: string,
): Array<[string, string | null]> {
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;
  const attributes: Array<[string, string | null]> = [];

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (/\bprivate\b/.test(modifiers)) {
      continue;
    }

    const name = match[2];

    if (!name) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const docBlock = phpDocBlockBefore(source, functionOffset);
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const returnType = bestPhpReturnType(declaredReturnType, documentedReturnType);
    const legacyAccessorName = phpLaravelLegacyAccessorAttributeName(name);

    if (legacyAccessorName) {
      attributes.push([legacyAccessorName, returnType ?? "mixed"]);
      continue;
    }

    if (phpLaravelAttributeAccessorReturnType(returnType)) {
      attributes.push([
        phpCamelCaseToSnakeCase(name),
        phpLaravelAttributeAccessorValueType(returnType) ?? "mixed",
      ]);
    }
  }

  return attributes;
}

function phpArrayAssignmentBodies(source: string, propertyName: string): string[] {
  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    `\\$${propertyName}\\s*=\\s*(?:\\[|array\\s*\\()`,
    "g",
  );
  const bodies: string[] = [];

  for (const match of masked.matchAll(pattern)) {
    const matched = match[0] ?? "";
    const shortArrayOffset = matched.lastIndexOf("[");
    const arrayCallOffset = matched.lastIndexOf("(");
    const isShortArray = shortArrayOffset > arrayCallOffset;
    const openOffset =
      match.index + (isShortArray ? shortArrayOffset : arrayCallOffset);
    const closeOffset = matchingPairOffset(
      source,
      openOffset,
      isShortArray ? "[" : "(",
      isShortArray ? "]" : ")",
    );

    if (closeOffset === null) {
      continue;
    }

    bodies.push(source.slice(openOffset + 1, closeOffset));
  }

  return bodies;
}

function phpLaravelCastReturnType(castExpression: string): string | null {
  const normalized = normalizeWhitespace(
    phpStringLiteralValue(castExpression) ?? castExpression,
  )
    .replace(/^\\+/, "")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("array") || normalized.includes("json")) {
    return "array";
  }

  if (normalized.includes("collection")) {
    return "\\Illuminate\\Support\\Collection";
  }

  if (/\b(?:bool|boolean)\b/.test(normalized)) {
    return "bool";
  }

  if (/\b(?:int|integer)\b/.test(normalized)) {
    return "int";
  }

  if (/\b(?:real|float|double)\b/.test(normalized)) {
    return "float";
  }

  if (normalized.startsWith("decimal")) {
    return "string";
  }

  if (
    normalized === "date" ||
    normalized === "datetime" ||
    normalized.startsWith("immutable_date") ||
    normalized.startsWith("immutable_datetime")
  ) {
    return "\\Illuminate\\Support\\Carbon";
  }

  if (
    normalized === "string" ||
    normalized === "encrypted" ||
    normalized === "hashed"
  ) {
    return "string";
  }

  if (normalized.includes("asstringable") || normalized.includes("stringable")) {
    return "\\Illuminate\\Support\\Stringable";
  }

  return "mixed";
}

function phpLaravelLegacyAccessorAttributeName(methodName: string): string | null {
  const match = /^get([A-Z][A-Za-z0-9_]*)Attribute$/.exec(methodName);
  const attributeName = match?.[1] ?? "";

  return attributeName ? phpCamelCaseToSnakeCase(attributeName) : null;
}

function phpLaravelAttributeAccessorReturnType(returnType: string | null): boolean {
  if (!returnType) {
    return false;
  }

  const baseType = returnType
    .trim()
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.split("\\")
    .pop()
    ?.toLowerCase();

  return baseType === "attribute";
}

function phpLaravelAttributeAccessorValueType(
  returnType: string | null,
): string | null {
  if (!returnType) {
    return null;
  }

  return normalizeReturnType(firstPhpGenericTypeArgument(returnType));
}

function phpCamelCaseToSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function firstPhpGenericTypeArgument(typeName: string): string | null {
  const start = typeName.indexOf("<");

  if (start < 0) {
    return null;
  }

  let depth = 0;

  for (let index = start + 1; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character === ">") {
      if (depth === 0) {
        return typeName.slice(start + 1, index).trim();
      }

      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      return typeName.slice(start + 1, index).trim();
    }
  }

  return null;
}

function topLevelArrayArrowIndex(source: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
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

    if (character === "=" && source[index + 1] === ">" && depth === 0) {
      return index;
    }
  }

  return -1;
}

function phpStringLiteralValue(expression: string): string | null {
  const trimmed = expression.trim();
  const match = /^(['"])([\s\S]*)\1$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return (match[2] ?? "").replace(/\\(['"\\])/g, "$1");
}

function isPhpAttributeName(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value));
}

function phpDocBlockBefore(source: string, functionOffset: number): string | null {
  const beforeFunction = source.slice(0, functionOffset);
  const docStart = beforeFunction.lastIndexOf("/**");
  const docEnd = beforeFunction.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const betweenDocAndFunction = beforeFunction
    .slice(docEnd + 2)
    .replace(/\b(?:abstract|final|private|protected|public|static)\b/g, " ")
    .trim();

  if (betweenDocAndFunction) {
    return null;
  }

  return beforeFunction.slice(docStart, docEnd + 2);
}

function phpDocReturnTypeFromBlock(docBlock: string | null): string | null {
  const returnMatch = /@return\s+([^\r\n*]+)/.exec(docBlock ?? "");

  return normalizeReturnType(firstPhpDocTypeToken(returnMatch?.[1] ?? null));
}

function bestPhpReturnType(
  declaredReturnType: string | null,
  documentedReturnType: string | null,
): string | null {
  if (
    documentedReturnType &&
    hasPhpGenericTypeArguments(documentedReturnType) &&
    !hasPhpGenericTypeArguments(declaredReturnType)
  ) {
    return documentedReturnType;
  }

  return declaredReturnType ?? documentedReturnType;
}

function hasPhpGenericTypeArguments(typeName: string | null): boolean {
  return Boolean(typeName && /<[^>]+>/.test(typeName));
}

function normalizeReturnType(returnType: string | null): string | null {
  const normalized = normalizeWhitespace(returnType ?? "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*&\s*/g, "&");

  return normalized || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitPhpParameterList(parameters: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
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

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(parameters.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(parameters.slice(start).trim());
  return parts.filter(Boolean);
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      if (character === "*" && next === "/") {
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function dedupePhpMembers(members: PhpMethodCompletion[]): PhpMethodCompletion[] {
  const seen = new Set<string>();
  const unique: PhpMethodCompletion[] = [];

  for (const member of members) {
    const key = `${member.kind ?? "method"}:${member.name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(member);
  }

  return unique;
}
