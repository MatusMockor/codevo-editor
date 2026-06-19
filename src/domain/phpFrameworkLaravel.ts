import type { PhpMethodCompletion } from "./phpMethodCompletions";
import type { EditorPosition } from "./languageServerFeatures";
import { firstPhpDocTypeToken } from "./phpDocTemplates";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "./phpSemanticEngine";
import { phpExtendsClassName, resolvePhpClassName } from "./phpNavigation";

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
  "firstornew",
  "firstwhere",
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

const laravelEloquentModelFluentMethods = new Set([
  "load",
  "loadcount",
  "loadmissing",
  "loadmorph",
]);

const laravelDatabaseQueryBuilderFactoryMethods = new Set(["table"]);

const laravelDatabaseQueryBuilderFluentMethods = new Set([
  "addselect",
  "crossjoin",
  "distinct",
  "from",
  "groupby",
  "having",
  "havingraw",
  "join",
  "latest",
  "leftjoin",
  "limit",
  "lock",
  "offset",
  "oldest",
  "orderby",
  "orderbydesc",
  "orwhere",
  "orwherebetween",
  "orwherecolumn",
  "orwheredate",
  "orwhereexists",
  "orwherein",
  "orwherenotbetween",
  "orwherenotin",
  "orwherenotnull",
  "orwherenull",
  "rightjoin",
  "select",
  "sharedlock",
  "skip",
  "take",
  "tap",
  "unless",
  "when",
  "where",
  "wherebetween",
  "wherecolumn",
  "wheredate",
  "whereday",
  "whereexists",
  "wherein",
  "wherejsoncontains",
  "wherejsonlength",
  "wheremonth",
  "wherenotbetween",
  "wherenotin",
  "wherenotnull",
  "wherenull",
  "whereraw",
  "wheretime",
  "whereyear",
]);

const laravelDatabaseConnectionTypes = new Set([
  "illuminate\\database\\connection",
  "illuminate\\database\\connectioninterface",
  "illuminate\\database\\databasemanager",
]);

const laravelDatabaseQueryBuilderTypes = new Set([
  "illuminate\\database\\query\\builder",
]);

const laravelCollectionTerminalModelMethods = new Set([
  "find",
  "first",
  "firstorfail",
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

const laravelRepositoryModelReturnMethods = new Set([
  "find",
  "findorfail",
  "first",
  "firstorfail",
  "sole",
]);

const laravelEloquentRelationTypes = new Set([
  "belongsto",
  "belongstomany",
  "hasmany",
  "hasmanythrough",
  "hasone",
  "hasonethrough",
  "morphmany",
  "morphone",
  "morphedbymany",
  "morphto",
  "morphtomany",
]);

const laravelEloquentSingularRelationTypes = new Set([
  "belongsto",
  "hasone",
  "hasonethrough",
  "morphone",
  "morphto",
]);

export interface PhpLaravelDynamicWhereAttributeTarget {
  attributeName: string;
  position: EditorPosition;
}

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

export function isLaravelEloquentModelFluentMethod(methodName: string): boolean {
  return laravelEloquentModelFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseQueryBuilderFactoryMethod(
  methodName: string,
): boolean {
  return laravelDatabaseQueryBuilderFactoryMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseQueryBuilderFluentMethod(
  methodName: string,
): boolean {
  return laravelDatabaseQueryBuilderFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseConnectionType(className: string): boolean {
  return laravelDatabaseConnectionTypes.has(normalizedLaravelClassName(className));
}

export function isLaravelDatabaseQueryBuilderType(className: string): boolean {
  return laravelDatabaseQueryBuilderTypes.has(normalizedLaravelClassName(className));
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

export function phpLaravelRepositoryMethodModelReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  if (
    !laravelRepositoryModelReturnMethods.has(methodName.toLowerCase()) ||
    !isLaravelRepositoryType(receiverType)
  ) {
    return null;
  }

  const receiverClassName = phpLaravelResolvedClassName(source, receiverType ?? "");
  const returnTypes = [
    ...phpLaravelRepositoryDeclaredMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
    ...phpLaravelRepositoryPhpDocMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
  ];

  return returnTypes
    .map((returnType) => phpLaravelModelTypeFromReturnType(source, returnType))
    .find((returnType): returnType is string => Boolean(returnType)) ?? null;
}

export function phpLaravelScopeMethodName(scopeName: string): string | null {
  const normalizedScopeName = scopeName.trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedScopeName)) {
    return null;
  }

  return `scope${normalizedScopeName[0]?.toUpperCase() ?? ""}${normalizedScopeName.slice(1)}`;
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

export function phpLaravelDynamicWhereCompletionsFromSource(
  source: string,
  declaringClassName: string,
  options: { isStatic?: boolean } = {},
): PhpMethodCompletion[] {
  const attributes = new Set<string>();

  for (const attribute of phpLaravelFillableAttributes(source)) {
    attributes.add(attribute);
  }

  for (const [attribute] of phpLaravelDefaultAttributes(source)) {
    attributes.add(attribute);
  }

  for (const [attribute] of phpLaravelCastAttributes(source)) {
    attributes.add(attribute);
  }

  return dedupePhpMembers(
    Array.from(attributes).flatMap((attribute) => {
      const suffix = phpLaravelDynamicWhereSuffix(attribute);

      if (!suffix) {
        return [];
      }

      return [
        {
          declaringClassName,
          ...(options.isStatic ? { isStatic: true } : {}),
          name: `where${suffix}`,
          parameters: "$value",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        },
      ];
    }),
  );
}

export function phpLaravelDynamicWhereAttributeTargetFromSource(
  source: string,
  methodName: string,
): PhpLaravelDynamicWhereAttributeTarget | null {
  const methodLookup = methodName.trim().toLowerCase();

  if (!methodLookup.startsWith("where")) {
    return null;
  }

  for (const occurrence of phpLaravelDynamicWhereAttributeOccurrences(source)) {
    const suffix = phpLaravelDynamicWhereSuffix(occurrence.attributeName);

    if (!suffix || `where${suffix}`.toLowerCase() !== methodLookup) {
      continue;
    }

    return {
      attributeName: occurrence.attributeName,
      position: editorPositionAtOffset(source, occurrence.attributeOffset),
    };
  }

  return null;
}

export function phpLaravelModelAttributeCompletionsFromSource(
  source: string,
  declaringClassName: string,
): PhpMethodCompletion[] {
  const attributes = new Map<string, string | null>();

  for (const attribute of phpLaravelFillableAttributes(source)) {
    attributes.set(attribute, "mixed");
  }

  for (const [attribute, returnType] of phpLaravelDefaultAttributes(source)) {
    attributes.set(attribute, returnType);
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

export function phpLaravelModelAttributeClassTypeFromSource(
  source: string,
  attributeName: string,
): string | null {
  const attributeLookup = attributeName.trim().toLowerCase();

  if (!attributeLookup) {
    return null;
  }

  const attribute = phpLaravelModelAttributeCompletionsFromSource(source, "").find(
    (completion) => completion.name.toLowerCase() === attributeLookup,
  );

  return attribute?.returnType
    ? phpDeclaredTypeCandidate(attribute.returnType)
    : null;
}

export function phpLaravelRelationPropertyCompletionsFromSource(
  source: string,
  declaringClassName: string,
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (/\b(?:private|protected|static)\b/.test(modifiers)) {
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
    const relationTargetType =
      phpLaravelRelationTypeForDeclaringClass(
        phpLaravelRelationModelTypeFromReturnType(returnType),
        declaringClassName,
        source,
      ) ??
      phpMethodReturnExpressions(source, name)
        .map((expression) =>
          phpLaravelRelationTypeForDeclaringClass(
            phpLaravelRelationTargetClassNameFromExpression(
              expression,
              true,
              phpLocalClassStringResolverForMethodReturnExpression(
                source,
                name,
                expression,
              ),
            ),
            declaringClassName,
            source,
          ),
        )
        .find((target): target is string => Boolean(target));

    if (!relationTargetType && !isLaravelEloquentRelationReturnType(returnType, true)) {
      continue;
    }

    members.push({
      declaringClassName,
      kind: "property",
      name,
      parameters: "",
      returnType: relationTargetType ?? "mixed",
    });
  }

  return dedupePhpMembers(members);
}

function laravelLocalScopeName(methodName: string): string | null {
  const match = /^scope([A-Z][A-Za-z0-9_]*)$/.exec(methodName);
  const scopeName = match?.[1];

  if (!scopeName) {
    return null;
  }

  return `${scopeName[0]?.toLowerCase() ?? ""}${scopeName.slice(1)}`;
}

function phpLaravelRepositoryDeclaredMethodReturnTypes(
  source: string,
  methodName: string,
  receiverClassName: string | null,
): string[] {
  return phpLaravelRepositoryTypeBodyRanges(source, receiverClassName).flatMap(
    (range) => {
      const body = maskPhpStringsAndComments(
        source.slice(range.bodyStart, range.bodyEnd),
      );
      const pattern = new RegExp(
        `(?:^|\\n)\\s*((?:(?:abstract|final|private|protected|public|static)\\s+)*)function\\s+&?\\s*${escapeRegExp(
          methodName,
        )}\\s*\\(([^)]*)\\)\\s*(?::\\s*([^;{\\n]+))?`,
        "g",
      );
      const returnTypes: string[] = [];

      for (const match of body.matchAll(pattern)) {
        const modifiers = (match[1] ?? "").toLowerCase();

        if (/\b(?:private|protected|static)\b/.test(modifiers)) {
          continue;
        }

        const functionOffset =
          range.bodyStart + (match.index ?? 0) + match[0].lastIndexOf("function");
        const docBlock = phpDocBlockBefore(source, functionOffset);
        const declaredReturnType = normalizeReturnType(match[3] ?? null);
        const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
        const returnType = bestPhpReturnType(
          declaredReturnType,
          documentedReturnType,
        );

        if (returnType) {
          returnTypes.push(returnType);
        }
      }

      return returnTypes;
    },
  );
}

function phpLaravelRepositoryPhpDocMethodReturnTypes(
  source: string,
  methodName: string,
  receiverClassName: string | null,
): string[] {
  return phpLaravelRepositoryTypeDocBlocks(source, receiverClassName).flatMap(
    (docBlock) => {
      const returnTypes: string[] = [];
      const pattern = new RegExp(
        `@method\\s+(?:static\\s+)?([^\\s(]+)\\s+${escapeRegExp(
          methodName,
        )}\\s*\\(`,
        "g",
      );

      for (const match of docBlock.matchAll(pattern)) {
        const returnType = normalizeReturnType(match[1] ?? null);

        if (returnType) {
          returnTypes.push(returnType);
        }
      }

      return returnTypes;
    },
  );
}

function phpLaravelRepositoryTypeBodyRanges(
  source: string,
  receiverClassName: string | null,
): Array<{ bodyEnd: number; bodyStart: number }> {
  const ranges: Array<{ bodyEnd: number; bodyStart: number }> = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;

  for (const match of masked.matchAll(pattern)) {
    const className = match[1] ?? "";
    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("{");
    const closeOffset = matchingPairOffset(source, openOffset, "{", "}");

    if (
      closeOffset === null ||
      !phpLaravelRepositoryTypeMatches(source, className, receiverClassName)
    ) {
      continue;
    }

    ranges.push({
      bodyEnd: closeOffset,
      bodyStart: openOffset + 1,
    });
  }

  return ranges;
}

function phpLaravelRepositoryTypeDocBlocks(
  source: string,
  receiverClassName: string | null,
): string[] {
  const docBlocks: string[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;

  for (const match of masked.matchAll(pattern)) {
    const className = match[1] ?? "";

    if (!phpLaravelRepositoryTypeMatches(source, className, receiverClassName)) {
      continue;
    }

    const docBlock = phpDocBlockBefore(source, match.index ?? 0);

    if (docBlock) {
      docBlocks.push(docBlock);
    }
  }

  return docBlocks;
}

function phpLaravelRepositoryTypeMatches(
  source: string,
  className: string,
  receiverClassName: string | null,
): boolean {
  const resolvedClassName = phpLaravelResolvedClassName(source, className);
  const normalizedReceiver = normalizedLaravelClassName(receiverClassName ?? "");

  if (!resolvedClassName || !normalizedReceiver) {
    return isLaravelRepositoryType(resolvedClassName ?? className);
  }

  return normalizedLaravelClassName(resolvedClassName) === normalizedReceiver;
}

function phpLaravelModelTypeFromReturnType(
  source: string,
  returnType: string | null,
): string | null {
  const candidate = phpDeclaredTypeCandidate(returnType ?? "");
  const resolvedClassName = phpLaravelResolvedClassName(source, candidate ?? "");

  if (!candidate || !resolvedClassName) {
    return null;
  }

  return isLaravelModelType(resolvedClassName) ? resolvedClassName : null;
}

function phpLaravelResolvedClassName(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = className.trim().replace(/^\\+/, "");

  if (!normalizedClassName) {
    return null;
  }

  if (normalizedClassName.includes("\\")) {
    return normalizedClassName;
  }

  return resolvePhpClassName(source, normalizedClassName)?.replace(/^\\+/, "") ?? null;
}

function isLaravelRepositoryType(className: string | null): boolean {
  return Boolean(className && /repository\b/i.test(className));
}

function isLaravelModelType(className: string): boolean {
  const normalized = className.trim().replace(/^\\+/, "");
  const shortName = normalized.split("\\").pop() ?? normalized;

  return normalized.includes("\\Models\\") || /Model$/.test(shortName);
}

interface PhpLaravelDynamicWhereAttributeOccurrence {
  attributeName: string;
  attributeOffset: number;
}

function phpLaravelDynamicWhereSuffix(attribute: string): string | null {
  const parts = attribute
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  return parts
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function phpLaravelDynamicWhereAttributeOccurrences(
  source: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [
    ...phpArrayStringValueOccurrences(source, "fillable"),
    ...phpArrayKeyOccurrences(source, "attributes"),
    ...phpArrayKeyOccurrences(source, "casts"),
  ];
  const seen = new Set<string>();

  return occurrences.filter((occurrence) => {
    const key = occurrence.attributeName.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizedLaravelClassName(className: string): string {
  return className.trim().replace(/^\\+/, "").toLowerCase();
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

function phpLaravelDefaultAttributes(
  source: string,
): Array<[string, string | null]> {
  return phpArrayAssignmentBodies(source, "attributes").flatMap((body) =>
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
          phpLaravelDefaultAttributeReturnType(item.slice(arrowIndex + 2)),
        ] satisfies [string, string | null],
      ];
    }),
  );
}

function phpLaravelCastAttributes(source: string): Array<[string, string | null]> {
  return phpLaravelCastAttributeBodies(source).flatMap((body) =>
    phpLaravelCastAttributesFromBody(source, body),
  );
}

function phpLaravelCastAttributeBodies(source: string): string[] {
  return [
    ...phpArrayAssignmentBodies(source, "casts"),
    ...phpMethodReturnExpressions(source, "casts").flatMap((expression) => {
      const body = phpArrayExpressionBody(expression);

      return body ? [body] : [];
    }),
  ];
}

function phpLaravelCastAttributesFromBody(
  source: string,
  body: string,
): Array<[string, string | null]> {
  return splitPhpParameterList(body).flatMap((item) => {
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
        phpLaravelCastReturnType(source, item.slice(arrowIndex + 2)),
      ] satisfies [string, string | null],
    ];
  });
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
  return phpArrayAssignmentRanges(source, propertyName).map((range) => range.body);
}

interface PhpArrayAssignmentRange {
  body: string;
  bodyOffset: number;
}

function phpArrayAssignmentRanges(
  source: string,
  propertyName: string,
): PhpArrayAssignmentRange[] {
  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    `\\$${propertyName}\\s*=\\s*(?:\\[|array\\s*\\()`,
    "g",
  );
  const ranges: PhpArrayAssignmentRange[] = [];

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

    ranges.push({
      body: source.slice(openOffset + 1, closeOffset),
      bodyOffset: openOffset + 1,
    });
  }

  return ranges;
}

function phpArrayStringValueOccurrences(
  source: string,
  propertyName: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  return phpArrayAssignmentRanges(source, propertyName).flatMap((range) => {
    const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [];
    const pattern = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g;

    for (const match of range.body.matchAll(pattern)) {
      const attributeName = match[2] ?? "";

      if (!isPhpAttributeName(attributeName)) {
        continue;
      }

      occurrences.push({
        attributeName,
        attributeOffset: range.bodyOffset + (match.index ?? 0) + 1,
      });
    }

    return occurrences;
  });
}

function phpArrayKeyOccurrences(
  source: string,
  propertyName: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  return phpArrayAssignmentRanges(source, propertyName).flatMap((range) => {
    const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [];
    const pattern = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*=>/g;

    for (const match of range.body.matchAll(pattern)) {
      const attributeName = match[2] ?? "";

      if (!isPhpAttributeName(attributeName)) {
        continue;
      }

      occurrences.push({
        attributeName,
        attributeOffset: range.bodyOffset + (match.index ?? 0) + 1,
      });
    }

    return occurrences;
  });
}

function phpArrayExpressionBody(expression: string): string | null {
  const trimmed = expression.trim();
  const shortArrayOffset = trimmed.search(/\[/);
  const arrayCallMatch = /\barray\s*\(/i.exec(trimmed);
  const arrayCallOffset = arrayCallMatch?.index ?? -1;

  if (
    shortArrayOffset >= 0 &&
    (arrayCallOffset < 0 || shortArrayOffset < arrayCallOffset)
  ) {
    const closeOffset = matchingPairOffset(trimmed, shortArrayOffset, "[", "]");

    return closeOffset === null
      ? null
      : trimmed.slice(shortArrayOffset + 1, closeOffset);
  }

  if (arrayCallOffset >= 0) {
    const openOffset =
      arrayCallOffset + (arrayCallMatch?.[0].lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(trimmed, openOffset, "(", ")");

    return closeOffset === null ? null : trimmed.slice(openOffset + 1, closeOffset);
  }

  return null;
}

function phpLaravelCastReturnType(
  source: string,
  castExpression: string,
): string | null {
  const classConstantType = phpLaravelCastClassConstantType(
    source,
    castExpression,
  );

  if (classConstantType) {
    return classConstantType;
  }

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

function phpLaravelCastClassConstantType(
  source: string,
  castExpression: string,
): string | null {
  const match =
    /^\s*(\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*\s*::\s*class\b/.exec(
      castExpression,
    );
  const className = match?.[0]
    ?.replace(/\s*::\s*class\b.*/i, "")
    .trim();

  return className ? resolvePhpClassName(source, className) : null;
}

function phpLaravelDefaultAttributeReturnType(
  valueExpression: string,
): string | null {
  const value = valueExpression.trim();

  if (!value) {
    return "mixed";
  }

  if (phpStringLiteralValue(value) !== null) {
    return "string";
  }

  if (/^(?:true|false)$/i.test(value)) {
    return "bool";
  }

  if (/^-?\d+$/.test(value)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+)$/i.test(value)) {
    return "float";
  }

  if (/^null$/i.test(value)) {
    return "mixed";
  }

  if (/^(?:\[|array\s*\()/i.test(value)) {
    return "array";
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

export function phpLaravelRelationTargetClassNameFromExpression(
  expression: string,
  includeCollectionRelations: boolean,
  localClassStringResolver?: (variableName: string) => string | null,
): string | null {
  const normalizedExpression = expression.trim();
  const pattern =
    /\b(belongsTo|belongsToMany|hasMany|hasManyThrough|hasOne|hasOneThrough|morphMany|morphOne|morphedByMany|morphToMany)\s*\(/g;

  for (const match of normalizedExpression.matchAll(pattern)) {
    const relationType = match[1]?.toLowerCase();

    if (!relationType) {
      continue;
    }

    if (
      !includeCollectionRelations &&
      !laravelEloquentSingularRelationTypes.has(relationType)
    ) {
      continue;
    }

    const openOffset = (match.index ?? 0) + (match[0]?.lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(
      normalizedExpression,
      openOffset,
      "(",
      ")",
    );

    if (closeOffset === null) {
      continue;
    }

    const targetClassName = phpLaravelRelationTargetClassNameFromArguments(
      normalizedExpression.slice(openOffset + 1, closeOffset),
      localClassStringResolver,
    );

    if (targetClassName) {
      return targetClassName;
    }
  }

  return null;
}

function phpLaravelRelationTargetClassNameFromArguments(
  argumentsSource: string,
  localClassStringResolver?: (variableName: string) => string | null,
): string | null {
  const classNamePattern =
    String.raw`(?:__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;
  const classNameReferencePattern = new RegExp(
    String.raw`^(` + classNamePattern + String.raw`)\s*::\s*class\b`,
  );

  for (const [index, argument] of splitPhpParameterList(
    argumentsSource,
  ).entries()) {
    const namedArgumentMatch =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(argument);
    const argumentName = namedArgumentMatch?.[1]?.toLowerCase() ?? null;
    const value = (namedArgumentMatch?.[2] ?? argument).trim();

    if (argumentName && argumentName !== "related") {
      continue;
    }

    if (!argumentName && index > 0) {
      continue;
    }

    if (/^__CLASS__\b/i.test(value)) {
      return "__CLASS__";
    }

    const classNameMatch = classNameReferencePattern.exec(value);
    const className = classNameMatch?.[1]?.replace(/^\\+/, "") ?? null;

    if (className) {
      return className;
    }

    const variableName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.[1];
    const localClassString = variableName
      ? localClassStringResolver?.(variableName)
      : null;

    if (localClassString) {
      return localClassString;
    }

    const stringClassName = phpStringLiteralValue(value)?.replace(/^\\+/, "");

    if (
      stringClassName &&
      /^[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)+$/.test(
        stringClassName,
      )
    ) {
      return stringClassName;
    }
  }

  return null;
}

function phpLocalClassStringResolverForMethodReturnExpression(
  source: string,
  methodName: string,
  returnExpression: string,
): ((variableName: string) => string | null) | undefined {
  const bodyBeforeReturn = phpMethodBodyBeforeReturnExpression(
    source,
    methodName,
    returnExpression,
  );

  if (bodyBeforeReturn === null) {
    return undefined;
  }

  return (variableName: string) =>
    phpLocalClassStringAssignmentBefore(bodyBeforeReturn, variableName);
}

function phpMethodBodyBeforeReturnExpression(
  source: string,
  methodName: string,
  returnExpression: string,
): string | null {
  const pattern = new RegExp(
    String.raw`\bfunction\s+&?\s*` + escapeRegExp(methodName) + String.raw`\s*\(`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    const body = source.slice(bodyStart + 1, bodyEnd);
    const returnOffset = body.indexOf(returnExpression);

    if (returnOffset >= 0) {
      return body.slice(0, returnOffset);
    }
  }

  return null;
}

function phpLocalClassStringAssignmentBefore(
  source: string,
  variableName: string,
): string | null {
  const classNamePattern =
    String.raw`(__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*` +
    String.raw`(?:\\[A-Za-z_][A-Za-z0-9_]*)*)`;
  const assignmentPattern = new RegExp(
    String.raw`\$` +
      escapeRegExp(variableName) +
      String.raw`\s*=\s*` +
      classNamePattern +
      String.raw`\s*::\s*class\b`,
    "g",
  );
  let className: string | null = null;

  for (const match of source.matchAll(assignmentPattern)) {
    className = match[1]?.replace(/^\\+/, "") ?? null;
  }

  return className;
}

function phpLaravelRelationModelTypeFromReturnType(
  returnType: string | null,
): string | null {
  if (!isLaravelEloquentRelationReturnType(returnType, true)) {
    return null;
  }

  return phpDeclaredGenericTypeCandidates(returnType ?? "").find(
    (candidate) => !isGenericLaravelRelationPlaceholder(candidate),
  ) ?? null;
}

function phpLaravelRelationTypeForDeclaringClass(
  relationType: string | null,
  declaringClassName: string,
  source: string,
): string | null {
  const normalized = relationType?.trim().replace(/^\\+/, "").toLowerCase();

  if (
    normalized === "__class__" ||
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this"
  ) {
    return declaringClassName;
  }

  if (normalized === "parent") {
    const parentClassName = phpExtendsClassName(source);

    return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
  }

  return relationType;
}

function isLaravelEloquentRelationReturnType(
  returnType: string | null,
  includeCollectionRelations: boolean,
): boolean {
  const typeName = phpDeclaredTypeCandidate(returnType ?? "");
  const normalizedTypeName = (typeName ?? returnType ?? "")
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  if (!normalizedTypeName) {
    return false;
  }

  const shortTypeName = normalizedTypeName.startsWith(
    "illuminate\\database\\eloquent\\relations\\",
  )
    ? normalizedTypeName.split("\\").pop() ?? normalizedTypeName
    : normalizedTypeName;

  return includeCollectionRelations
    ? laravelEloquentRelationTypes.has(shortTypeName)
    : laravelEloquentSingularRelationTypes.has(shortTypeName);
}

function isGenericLaravelRelationPlaceholder(typeName: string): boolean {
  const normalized = typeName.trim().replace(/^\\+/, "").toLowerCase();

  return (
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this" ||
    normalized === "illuminate\\database\\eloquent\\model" ||
    normalized === "model" ||
    /^t[A-Z_]/.test(typeName)
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  const offset = Math.max(0, Math.min(source.length, targetOffset));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}
