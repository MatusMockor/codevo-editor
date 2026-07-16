import { collectLatteMaskedRegions, LATTE_TAG_NAMES } from "./latteSyntax";

export interface LatteBlockSourceSpan {
  end: number;
  start: number;
}

export interface LatteBlockParameter {
  defaultValue: string | null;
  defaultValueSpan: LatteBlockSourceSpan | null;
  name: string;
  nameSpan: LatteBlockSourceSpan;
  span: LatteBlockSourceSpan;
  type: string | null;
  typeSpan: LatteBlockSourceSpan | null;
}

export interface LatteBlockDefinition {
  bodySpan: LatteBlockSourceSpan;
  kind: "define" | "local";
  name: string;
  nameSpan: LatteBlockSourceSpan;
  parameters: LatteBlockParameter[];
  tagSpan: LatteBlockSourceSpan;
}

export interface LatteBlockIncludeArgument {
  kind: "named" | "positional";
  name: string | null;
  nameSpan: LatteBlockSourceSpan | null;
  span: LatteBlockSourceSpan;
  value: string;
  valueSpan: LatteBlockSourceSpan;
}

export interface LatteBlockInclude {
  arguments: LatteBlockIncludeArgument[];
  name: string;
  nameSpan: LatteBlockSourceSpan;
  ownerDefinition: LatteBlockDefinition | null;
  tagSpan: LatteBlockSourceSpan;
}

export interface LatteBlockSyntaxDocument {
  definitions: LatteBlockDefinition[];
  includes: LatteBlockInclude[];
}

interface TagToken {
  contentEnd: number;
  expressionStart: number;
  isClosing: boolean;
  isValid: boolean;
  name: string;
  nextOffset: number;
  openBrace: number;
}

interface OpenDefinition {
  closingTag: "block" | "define";
  kind: "define" | "local";
  name: string;
  nameSpan: LatteBlockSourceSpan;
  parameters: LatteBlockParameter[];
  tagSpan: LatteBlockSourceSpan;
}

interface PairedTagFrame {
  canCloseAtEof: boolean;
  closingTag: string;
  definition: OpenDefinition | null;
  isDefinition: boolean;
  ownerDefinition: OpenDefinition | null;
}

interface PendingInclude {
  include: Omit<LatteBlockInclude, "ownerDefinition">;
  owner: OpenDefinition | null;
}

interface Segment {
  end: number;
  start: number;
}

interface ScanState {
  closers: string[];
  index: number;
  malformed: boolean;
}

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const BLOCK_NAME_PART = /[A-Za-z0-9_.-]/;
const RESERVED_INCLUDE_NAMES = new Set(["block", "parent", "this"]);
const LATTE_TAG_NAME_SET = new Set(LATTE_TAG_NAMES);
const PAIRED_TAG_NAMES = new Set([
  "block",
  "cache",
  "capture",
  "embed",
  "first",
  "for",
  "foreach",
  "form",
  "formContainer",
  "formContext",
  "if",
  "ifchanged",
  "ifset",
  "iterateWhile",
  "label",
  "last",
  "sep",
  "snippet",
  "snippetArea",
  "spaceless",
  "switch",
  "translate",
  "try",
  "while",
]);
const MAX_TAG_LENGTH = 64_000;

/** Parses same-file static Latte definitions and block includes in one bounded pass. */
export function parseLatteBlockSyntax(source: string): LatteBlockSyntaxDocument {
  const definitions: LatteBlockDefinition[] = [];
  const closedDefinitions = new Map<OpenDefinition, LatteBlockDefinition>();
  const pendingIncludes: PendingInclude[] = [];
  const pairedFrames: PairedTagFrame[] = [];
  const masks = collectLatteMaskedRegions(source);
  let maskIndex = 0;
  let index = 0;

  while (index < source.length) {
    const mask = masks[maskIndex];

    if (mask && index >= mask.end) {
      maskIndex += 1;
      continue;
    }

    if (mask && index >= mask.start) {
      index = Math.max(index + 1, mask.end);
      maskIndex += 1;
      continue;
    }

    if (source[index] !== "{" || isEscaped(source, index)) {
      index += 1;
      continue;
    }

    const tag = scanTag(source, index);

    if (!tag) {
      index += 1;
      continue;
    }

    index = tag.nextOffset;

    if (!tag.isValid) {
      pushMalformedDefinitionFrame(source, tag, pairedFrames);
      continue;
    }

    if (tag.isClosing) {
      closePairedTag(
        source,
        tag,
        pairedFrames,
        definitions,
        closedDefinitions,
      );
      continue;
    }

    const definition = parseOpeningDefinition(source, tag);

    if (definition) {
      pairedFrames.push({
        canCloseAtEof: definition.kind === "local",
        closingTag: definition.closingTag,
        definition,
        isDefinition: true,
        ownerDefinition: definition,
      });
      continue;
    }

    if (tag.name === "define") {
      pairedFrames.push(invalidDefinitionFrame("define"));
      continue;
    }

    if (isLocalBlockHeader(source, tag)) {
      pairedFrames.push(invalidDefinitionFrame("block"));
      continue;
    }

    if (tag.name !== "include") {
      pushControlFrame(tag, pairedFrames);
      continue;
    }

    const include = parseBlockInclude(source, tag);

    if (include) {
      pendingIncludes.push({
        include,
        owner:
          pairedFrames[pairedFrames.length - 1]?.ownerDefinition ?? null,
      });
    }
  }

  finalizeTopLevelLocalAtEof(
    source,
    pairedFrames,
    definitions,
    closedDefinitions,
  );
  definitions.sort((left, right) => left.tagSpan.start - right.tagSpan.start);

  const includes = pendingIncludes.map(({ include, owner }) => ({
    ...include,
    ownerDefinition: owner ? (closedDefinitions.get(owner) ?? null) : null,
  }));

  return { definitions, includes };
}

/** Alias kept convenient for callers that use the module name as the parser name. */
export const latteBlockSyntax = parseLatteBlockSyntax;

function scanTag(source: string, openBrace: number): TagToken | null {
  let index = openBrace + 1;
  let isClosing = false;

  if (source[index] === "/") {
    isClosing = true;
    index += 1;
  }

  if (isClosing && source[index] === "}") {
    const content = scanTagContent(source, index);

    return {
      ...content,
      expressionStart: index,
      isClosing,
      name: "",
      openBrace,
    };
  }

  if (!IDENTIFIER_START.test(source[index] ?? "")) {
    return null;
  }

  const nameStart = index;
  index += 1;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const name = source.slice(nameStart, index);

  if (!isRelevantTag(name)) {
    return null;
  }

  const next = source[index] ?? "";

  if (next !== "}" && !isWhitespace(next)) {
    return null;
  }

  const expressionStart = skipWhitespace(source, index, source.length);
  const content = scanTagContent(source, expressionStart);

  return {
    ...content,
    expressionStart,
    isClosing,
    name,
    openBrace,
  };
}

function scanTagContent(
  source: string,
  from: number,
): Pick<TagToken, "contentEnd" | "isValid" | "nextOffset"> {
  const state: ScanState = { closers: [], index: from, malformed: false };
  const limit = Math.min(source.length, from + MAX_TAG_LENGTH);

  while (state.index < limit) {
    const char = source[state.index] ?? "";

    if (
      char === "{" &&
      state.closers.length === 0 &&
      looksLikeNestedLatteTag(source, state.index)
    ) {
      return {
        contentEnd: state.index,
        isValid: false,
        nextOffset: state.index,
      };
    }

    if (char === "'" || char === '"') {
      const quoteEnd = quotedEnd(source, state.index, limit);

      if (quoteEnd === null) {
        return failedLine(source, state.index + 1, limit);
      }

      state.index = quoteEnd + 1;
      continue;
    }

    const commentEnd = phpCommentEnd(
      source,
      state.index,
      state.index === from,
      limit,
    );

    if (commentEnd !== undefined) {
      if (commentEnd === null) {
        return failedLine(source, state.index + 2, limit);
      }

      state.index = commentEnd;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      state.closers.push(closingDelimiter(char));
      state.index += 1;
      continue;
    }

    if (char === ")" || char === "]") {
      const expected = state.closers.pop();

      if (expected !== char) {
        state.malformed = true;
      }

      state.index += 1;
      continue;
    }

    if (char !== "}") {
      state.index += 1;
      continue;
    }

    const expected = state.closers[state.closers.length - 1];

    if (!expected) {
      return {
        contentEnd: state.index,
        isValid: !state.malformed,
        nextOffset: state.index + 1,
      };
    }

    state.closers.pop();

    if (expected !== "}") {
      state.malformed = true;
    }

    state.index += 1;
  }

  return { contentEnd: limit, isValid: false, nextOffset: limit };
}

function parseOpeningDefinition(
  source: string,
  tag: TagToken,
): OpenDefinition | null {
  if (tag.name === "define") {
    const nameStart = defineNameStart(source, tag);
    return parseDefinitionHeader(source, tag, "define", nameStart, true);
  }

  if (tag.name !== "block") {
    return null;
  }

  if (!isLocalBlockHeader(source, tag)) {
    return null;
  }

  const localEnd = readWordEnd(source, tag.expressionStart, tag.contentEnd);
  const nameStart = skipWhitespace(source, localEnd, tag.contentEnd);

  return parseDefinitionHeader(source, tag, "local", nameStart, false);
}

function parseDefinitionHeader(
  source: string,
  tag: TagToken,
  kind: "define" | "local",
  from: number,
  parametersAllowed: boolean,
): OpenDefinition | null {
  const target = staticBlockTarget(source, from, tag.contentEnd);

  if (!target) {
    return null;
  }

  let parameterStart = skipWhitespace(source, target.tokenEnd, tag.contentEnd);

  if (!parametersAllowed && parameterStart < tag.contentEnd) {
    return null;
  }

  if (source[parameterStart] === ",") {
    parameterStart = skipWhitespace(source, parameterStart + 1, tag.contentEnd);
  }

  const parameters = parseParameters(source, parameterStart, tag.contentEnd);

  if (!parameters) {
    return null;
  }

  return {
    closingTag: kind === "define" ? "define" : "block",
    kind,
    name: target.name,
    nameSpan: target.span,
    parameters,
    tagSpan: { end: tag.contentEnd + 1, start: tag.openBrace },
  };
}

function parseParameters(
  source: string,
  start: number,
  end: number,
): LatteBlockParameter[] | null {
  if (start >= end) {
    return [];
  }

  const segments = splitDefinitionParameters(source, start, end);

  if (!segments) {
    return null;
  }

  const parameters: LatteBlockParameter[] = [];

  for (const rawSegment of segments) {
    const segment = trimSpan(source, rawSegment.start, rawSegment.end);

    if (segment.start >= segment.end) {
      return null;
    }

    const parameter = parseParameter(source, segment);

    if (!parameter) {
      return null;
    }

    parameters.push(parameter);
  }

  return parameters;
}

function parseParameter(
  source: string,
  segment: Segment,
): LatteBlockParameter | null {
  const equals = findTopLevelOperator(source, segment.start, segment.end, "=");
  const declarationEnd = equals ?? segment.end;
  const variable = findVariable(source, segment.start, declarationEnd);

  if (!variable) {
    return null;
  }

  const afterName = skipWhitespace(source, variable.end, declarationEnd);

  if (afterName !== declarationEnd) {
    return null;
  }

  const rawTypeSpan = trimSpan(source, segment.start, variable.start);
  const typeSpan = rawTypeSpan.start < rawTypeSpan.end ? rawTypeSpan : null;

  if (typeSpan && !isStaticType(source.slice(typeSpan.start, typeSpan.end))) {
    return null;
  }

  let defaultValueSpan: LatteBlockSourceSpan | null = null;

  if (equals !== null) {
    const value = trimSpan(source, equals + 1, segment.end);

    if (value.start >= value.end) {
      return null;
    }

    defaultValueSpan = value;
  }

  return {
    defaultValue: defaultValueSpan
      ? source.slice(defaultValueSpan.start, defaultValueSpan.end)
      : null,
    defaultValueSpan,
    name: source.slice(variable.start + 1, variable.end),
    nameSpan: { end: variable.end, start: variable.start + 1 },
    span: segment,
    type: typeSpan ? source.slice(typeSpan.start, typeSpan.end) : null,
    typeSpan,
  };
}

function parseBlockInclude(
  source: string,
  tag: TagToken,
): Omit<LatteBlockInclude, "ownerDefinition"> | null {
  const explicitBlockMarker = hasIncludeBlockMarker(source, tag);
  const targetStart = includeBlockTargetStart(source, tag);
  const target = staticBlockTarget(source, targetStart, tag.contentEnd);

  if (!target || RESERVED_INCLUDE_NAMES.has(target.name)) {
    return null;
  }

  if (
    target.name.includes(".") &&
    !target.hasHashMarker &&
    !explicitBlockMarker
  ) {
    return null;
  }

  let argumentsStart = skipWhitespace(source, target.tokenEnd, tag.contentEnd);

  if (wordAt(source, argumentsStart, tag.contentEnd, "from")) {
    return null;
  }

  if (source[argumentsStart] === ",") {
    argumentsStart = skipWhitespace(source, argumentsStart + 1, tag.contentEnd);
  }

  const filterStart = findTopLevelOperator(
    source,
    argumentsStart,
    tag.contentEnd,
    "|",
  );
  const argumentsEnd = filterStart ?? tag.contentEnd;

  if (hasTopLevelWord(source, argumentsStart, argumentsEnd, "from")) {
    return null;
  }

  const args = parseIncludeArguments(source, argumentsStart, argumentsEnd);

  if (!args) {
    return null;
  }

  return {
    arguments: args,
    name: target.name,
    nameSpan: target.span,
    tagSpan: { end: tag.contentEnd + 1, start: tag.openBrace },
  };
}

function parseIncludeArguments(
  source: string,
  start: number,
  end: number,
): LatteBlockIncludeArgument[] | null {
  const complete = trimSpan(source, start, end);

  if (complete.start >= complete.end) {
    return [];
  }

  const segments = splitTopLevel(source, complete.start, complete.end, ",");

  if (!segments) {
    return null;
  }

  const args: LatteBlockIncludeArgument[] = [];

  for (const rawSegment of segments) {
    const segment = trimSpan(source, rawSegment.start, rawSegment.end);

    if (segment.start >= segment.end) {
      return null;
    }

    const arg = parseIncludeArgument(source, segment);

    if (!arg) {
      return null;
    }

    args.push(arg);
  }

  return args;
}

function parseIncludeArgument(
  source: string,
  segment: Segment,
): LatteBlockIncludeArgument | null {
  const named = namedArgumentHead(source, segment);

  if (!named) {
    return {
      kind: "positional",
      name: null,
      nameSpan: null,
      span: segment,
      value: source.slice(segment.start, segment.end),
      valueSpan: segment,
    };
  }

  const valueSpan = trimSpan(source, named.operatorEnd, segment.end);

  if (valueSpan.start >= valueSpan.end) {
    return null;
  }

  return {
    kind: "named",
    name: named.name,
    nameSpan: named.nameSpan,
    span: segment,
    value: source.slice(valueSpan.start, valueSpan.end),
    valueSpan,
  };
}

function namedArgumentHead(
  source: string,
  segment: Segment,
): {
  name: string;
  nameSpan: LatteBlockSourceSpan;
  operatorEnd: number;
} | null {
  let index = segment.start;
  let nameStart = index;
  let nameEnd = index;

  const quote = source[index] === "'" || source[index] === '"';

  if (quote) {
    const quote = source[index] ?? "";
    const quoteEnd = quotedEnd(source, index);

    if (quoteEnd === null || quoteEnd >= segment.end) {
      return null;
    }

    nameStart = index + 1;
    nameEnd = quoteEnd;
    index = quoteEnd + 1;

    if (!isIdentifier(source.slice(nameStart, nameEnd))) {
      return null;
    }

    if (source[nameEnd] !== quote) {
      return null;
    }
  }

  if (!quote && !IDENTIFIER_START.test(source[index] ?? "")) {
    return null;
  }

  if (!quote) {
    index += 1;

    while (IDENTIFIER_PART.test(source[index] ?? "")) {
      index += 1;
    }

    nameEnd = index;
  }

  index = skipWhitespace(source, index, segment.end);

  if (source[index] === ":") {
    return {
      name: source.slice(nameStart, nameEnd),
      nameSpan: { end: nameEnd, start: nameStart },
      operatorEnd: index + 1,
    };
  }

  if (source.slice(index, index + 2) !== "=>") {
    return null;
  }

  return {
    name: source.slice(nameStart, nameEnd),
    nameSpan: { end: nameEnd, start: nameStart },
    operatorEnd: index + 2,
  };
}

function closePairedTag(
  source: string,
  tag: TagToken,
  stack: PairedTagFrame[],
  definitions: LatteBlockDefinition[],
  closedDefinitions: Map<OpenDefinition, LatteBlockDefinition>,
): void {
  const frame = stack[stack.length - 1];

  if (!frame) {
    return;
  }

  if (tag.name !== "" && frame.closingTag !== tag.name) {
    frame.canCloseAtEof = false;
    return;
  }

  if (!frame.isDefinition) {
    stack.pop();
    return;
  }

  const closingName = optionalClosingName(source, tag);

  if (closingName === undefined) {
    frame.canCloseAtEof = false;
    return;
  }

  if (
    frame.definition &&
    closingName !== null &&
    closingName !== frame.definition.name
  ) {
    frame.canCloseAtEof = false;
    return;
  }

  stack.pop();
  const opening = frame.definition;

  if (!opening) {
    return;
  }

  completeDefinition(
    opening,
    tag.openBrace,
    definitions,
    closedDefinitions,
  );
}

function completeDefinition(
  opening: OpenDefinition,
  bodyEnd: number,
  definitions: LatteBlockDefinition[],
  closedDefinitions: Map<OpenDefinition, LatteBlockDefinition>,
): void {

  const definition: LatteBlockDefinition = {
    bodySpan: { end: bodyEnd, start: opening.tagSpan.end },
    kind: opening.kind,
    name: opening.name,
    nameSpan: opening.nameSpan,
    parameters: opening.parameters,
    tagSpan: opening.tagSpan,
  };

  definitions.push(definition);
  closedDefinitions.set(opening, definition);
}

function finalizeTopLevelLocalAtEof(
  source: string,
  stack: PairedTagFrame[],
  definitions: LatteBlockDefinition[],
  closedDefinitions: Map<OpenDefinition, LatteBlockDefinition>,
): void {
  if (stack.length !== 1) {
    return;
  }

  const frame = stack[0];
  const opening = frame?.definition;

  if (!frame?.isDefinition || !opening || opening.kind !== "local") {
    return;
  }

  if (!frame.canCloseAtEof) {
    return;
  }

  completeDefinition(opening, source.length, definitions, closedDefinitions);
  stack.pop();
}

function pushMalformedDefinitionFrame(
  source: string,
  tag: TagToken,
  stack: PairedTagFrame[],
): void {
  if (tag.isClosing) {
    return;
  }

  if (tag.name === "define") {
    stack.push(invalidDefinitionFrame("define"));
    return;
  }

  if (isLocalBlockHeader(source, tag)) {
    stack.push(invalidDefinitionFrame("block"));
  }
}

function invalidDefinitionFrame(closingTag: "block" | "define"): PairedTagFrame {
  return {
    canCloseAtEof: false,
    closingTag,
    definition: null,
    isDefinition: true,
    ownerDefinition: null,
  };
}

function pushControlFrame(tag: TagToken, stack: PairedTagFrame[]): void {
  if (!PAIRED_TAG_NAMES.has(tag.name)) {
    return;
  }

  stack.push({
    canCloseAtEof: false,
    closingTag: tag.name,
    definition: null,
    isDefinition: false,
    ownerDefinition: stack[stack.length - 1]?.ownerDefinition ?? null,
  });
}

function defineNameStart(source: string, tag: TagToken): number {
  const localEnd = readWordEnd(source, tag.expressionStart, tag.contentEnd);

  if (source.slice(tag.expressionStart, localEnd) !== "local") {
    return tag.expressionStart;
  }

  const candidate = skipWhitespace(source, localEnd, tag.contentEnd);

  if (!IDENTIFIER_START.test(source[candidate] ?? "")) {
    return tag.expressionStart;
  }

  return candidate;
}

function isLocalBlockHeader(source: string, tag: TagToken): boolean {
  if (tag.name !== "block") {
    return false;
  }

  const localEnd = readWordEnd(source, tag.expressionStart, tag.contentEnd);
  return source.slice(tag.expressionStart, localEnd) === "local";
}

function optionalClosingName(
  source: string,
  tag: TagToken,
): string | null | undefined {
  const content = trimSpan(source, tag.expressionStart, tag.contentEnd);

  if (content.start >= content.end) {
    return null;
  }

  if (source[content.start] === "#") {
    return undefined;
  }

  const target = staticBlockTarget(source, content.start, content.end);

  if (!target) {
    return undefined;
  }

  if (skipWhitespace(source, target.tokenEnd, content.end) !== content.end) {
    return undefined;
  }

  return target.name;
}

function includeBlockTargetStart(source: string, tag: TagToken): number {
  const blockEnd = readWordEnd(source, tag.expressionStart, tag.contentEnd);

  if (source.slice(tag.expressionStart, blockEnd) !== "block") {
    return tag.expressionStart;
  }

  return skipWhitespace(source, blockEnd, tag.contentEnd);
}

function hasIncludeBlockMarker(source: string, tag: TagToken): boolean {
  const blockEnd = readWordEnd(source, tag.expressionStart, tag.contentEnd);
  return source.slice(tag.expressionStart, blockEnd) === "block";
}

function staticBlockTarget(
  source: string,
  from: number,
  end: number,
): {
  hasHashMarker: boolean;
  name: string;
  span: LatteBlockSourceSpan;
  tokenEnd: number;
} | null {
  let index = skipWhitespace(source, from, end);
  const hasHashMarker = source[index] === "#";

  if (hasHashMarker) {
    index += 1;
  }

  if (!IDENTIFIER_START.test(source[index] ?? "")) {
    return null;
  }

  const nameStart = index;
  index += 1;

  while (index < end && BLOCK_NAME_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const following = source[index] ?? "";

  if (
    index < end &&
    following !== "," &&
    !isWhitespace(following) &&
    following !== "|"
  ) {
    return null;
  }

  return {
    hasHashMarker,
    name: source.slice(nameStart, index),
    span: { end: index, start: nameStart },
    tokenEnd: index,
  };
}

function splitTopLevel(
  source: string,
  start: number,
  end: number,
  separator: string,
): Segment[] | null {
  const segments: Segment[] = [];
  const closers: string[] = [];
  let segmentStart = start;
  let index = start;

  while (index < end) {
    const skipped = skipOpaque(source, index, end);

    if (skipped !== null) {
      if (skipped < 0) {
        return null;
      }

      index = skipped;
      continue;
    }

    const char = source[index] ?? "";

    if (char === "(" || char === "[" || char === "{") {
      closers.push(closingDelimiter(char));
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      if (closers.pop() !== char) {
        return null;
      }

      index += 1;
      continue;
    }

    if (char === separator && closers.length === 0) {
      segments.push({ end: index, start: segmentStart });
      segmentStart = index + 1;
    }

    index += 1;
  }

  if (closers.length > 0) {
    return null;
  }

  segments.push({ end, start: segmentStart });
  return segments;
}

function splitDefinitionParameters(
  source: string,
  start: number,
  end: number,
): Segment[] | null {
  const segments: Segment[] = [];
  const closers: string[] = [];
  let segmentStart = start;
  let variableSeen = false;
  let index = start;

  while (index < end) {
    const skipped = skipOpaque(source, index, end);

    if (skipped !== null) {
      if (skipped < 0) {
        return null;
      }

      index = skipped;
      continue;
    }

    const char = source[index] ?? "";

    if (char === "$" && closers.length === 0) {
      variableSeen = true;
      index += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      closers.push(closingDelimiter(char));
      index += 1;
      continue;
    }

    if (char === "<" && !variableSeen) {
      closers.push(">");
      index += 1;
      continue;
    }

    if (char === ">" && closers[closers.length - 1] !== ">") {
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}" || char === ">") {
      if (closers.pop() !== char) {
        return null;
      }

      index += 1;
      continue;
    }

    if (char === "," && closers.length === 0) {
      segments.push({ end: index, start: segmentStart });
      segmentStart = index + 1;
      variableSeen = false;
    }

    index += 1;
  }

  if (closers.length > 0) {
    return null;
  }

  segments.push({ end, start: segmentStart });
  return segments;
}

function findTopLevelOperator(
  source: string,
  start: number,
  end: number,
  operator: string,
): number | null {
  const closers: string[] = [];
  let index = start;

  while (index < end) {
    const skipped = skipOpaque(source, index, end);

    if (skipped !== null) {
      if (skipped < 0) {
        return null;
      }

      index = skipped;
      continue;
    }

    const char = source[index] ?? "";

    if (char === "(" || char === "[" || char === "{") {
      closers.push(closingDelimiter(char));
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      closers.pop();
      index += 1;
      continue;
    }

    if (char === operator && closers.length === 0) {
      return index;
    }

    index += 1;
  }

  return null;
}

function findVariable(
  source: string,
  start: number,
  end: number,
): LatteBlockSourceSpan | null {
  let index = start;

  while (index < end) {
    if (source[index] !== "$") {
      index += 1;
      continue;
    }

    const variableStart = index;
    index += 1;

    if (!IDENTIFIER_START.test(source[index] ?? "")) {
      return null;
    }

    index += 1;

    while (IDENTIFIER_PART.test(source[index] ?? "")) {
      index += 1;
    }

    return { end: index, start: variableStart };
  }

  return null;
}

function hasTopLevelWord(
  source: string,
  start: number,
  end: number,
  word: string,
): boolean {
  const closers: string[] = [];
  let index = start;

  while (index < end) {
    const skipped = skipOpaque(source, index, end);

    if (skipped !== null) {
      if (skipped < 0) {
        return true;
      }

      index = skipped;
      continue;
    }

    const char = source[index] ?? "";

    if (char === "(" || char === "[" || char === "{") {
      closers.push(closingDelimiter(char));
      index += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      closers.pop();
      index += 1;
      continue;
    }

    const wordEnd = readWordEnd(source, index, end);

    if (
      closers.length === 0 &&
      wordEnd > index &&
      source.slice(index, wordEnd) === word
    ) {
      return true;
    }

    index = wordEnd > index ? wordEnd : index + 1;
  }

  return false;
}

function wordAt(source: string, start: number, end: number, word: string): boolean {
  const wordEnd = readWordEnd(source, start, end);
  return source.slice(start, wordEnd) === word;
}

function readWordEnd(source: string, start: number, end: number): number {
  let index = start;

  while (index < end && IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function skipOpaque(source: string, index: number, end: number): number | null {
  const char = source[index] ?? "";

  if (char === "'" || char === '"') {
    const quoteEnd = quotedEnd(source, index);

    if (quoteEnd === null || quoteEnd >= end) {
      return -1;
    }

    return quoteEnd + 1;
  }

  const commentEnd = phpCommentEnd(source, index, false, end);

  if (commentEnd === undefined) {
    return null;
  }

  if (commentEnd === null || commentEnd > end) {
    return -1;
  }

  return commentEnd;
}

function quotedEnd(
  source: string,
  quoteStart: number,
  limit = source.length,
): number | null {
  const quote = source[quoteStart] ?? "";
  let index = quoteStart + 1;

  while (index < limit) {
    const char = source[index] ?? "";

    if (char === "\n" || char === "\r") {
      return null;
    }

    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === quote) {
      return index;
    }

    index += 1;
  }

  return null;
}

function phpCommentEnd(
  source: string,
  start: number,
  hashIsBlockMarker = false,
  limit = source.length,
): number | null | undefined {
  if (source.slice(start, start + 2) === "/*") {
    const end = source.indexOf("*/", start + 2);
    return end < 0 || end + 2 > limit ? null : end + 2;
  }

  if (
    source.slice(start, start + 2) !== "//" &&
    (source[start] !== "#" || hashIsBlockMarker)
  ) {
    return undefined;
  }

  const newline = source.indexOf("\n", start + 1);
  return newline < 0 || newline > limit ? limit : newline;
}

function failedLine(
  source: string,
  from: number,
  limit = source.length,
): Pick<TagToken, "contentEnd" | "isValid" | "nextOffset"> {
  const newline = source.indexOf("\n", from);
  const end = newline < 0 ? limit : Math.min(newline, limit);
  return { contentEnd: end, isValid: false, nextOffset: end };
}

function trimSpan(source: string, start: number, end: number): Segment {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && isWhitespace(source[trimmedStart] ?? "")) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && isWhitespace(source[trimmedEnd - 1] ?? "")) {
    trimmedEnd -= 1;
  }

  return { end: trimmedEnd, start: trimmedStart };
}

function skipWhitespace(source: string, start: number, end: number): number {
  let index = start;

  while (index < end && isWhitespace(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function closingDelimiter(open: string): string {
  if (open === "(") {
    return ")";
  }

  if (open === "[") {
    return "]";
  }

  return "}";
}

function isRelevantTag(name: string): boolean {
  return name === "define" || name === "include" || PAIRED_TAG_NAMES.has(name);
}

function looksLikeNestedLatteTag(source: string, openBrace: number): boolean {
  if (!isWhitespace(source[openBrace - 1] ?? "")) {
    return false;
  }

  let index = openBrace + 1;

  if (source[index] === "/") {
    index += 1;

    if (source[index] === "}") {
      return true;
    }
  }

  if (!IDENTIFIER_START.test(source[index] ?? "")) {
    return false;
  }

  const nameStart = index;
  index += 1;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const name = source.slice(nameStart, index);

  if (!LATTE_TAG_NAME_SET.has(name) && !PAIRED_TAG_NAMES.has(name)) {
    return false;
  }

  const next = source[index] ?? "";
  return next === "}" || isWhitespace(next);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isStaticType(value: string): boolean {
  if (!/[A-Za-z_]/.test(value)) {
    return false;
  }

  if (!/^[A-Za-z0-9_\\\s?<>[\]{}():,|&.=]+$/.test(value)) {
    return false;
  }

  const closers: string[] = [];

  for (const char of value) {
    if (char === "(" || char === "[" || char === "{") {
      closers.push(closingDelimiter(char));
      continue;
    }

    if (char === "<") {
      closers.push(">");
      continue;
    }

    if (char !== ")" && char !== "]" && char !== "}" && char !== ">") {
      continue;
    }

    if (closers.pop() !== char) {
      return false;
    }
  }

  return closers.length === 0;
}

function isEscaped(source: string, offset: number): boolean {
  let slashes = 0;
  let index = offset - 1;

  while (index >= 0 && source[index] === "\\") {
    slashes += 1;
    index -= 1;
  }

  return slashes % 2 === 1;
}
