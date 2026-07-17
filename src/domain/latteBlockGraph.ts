import { collectLatteMaskedRegions } from "./latteSyntax";

export type LatteTemplateRelationKind =
  | "embed"
  | "extends"
  | "import"
  | "layout";

export interface LatteTemplateRelationSpan {
  end: number;
  start: number;
}

export interface LatteTemplateRelation {
  kind: LatteTemplateRelationKind;
  path: string;
  pathSpan: LatteTemplateRelationSpan;
}

export interface LatteTemplateRelations {
  hasDynamicRelation: boolean;
  hasParentTag: boolean;
  relations: LatteTemplateRelation[];
}

interface RelationTagToken {
  isDynamic: boolean;
  kind: LatteTemplateRelationKind;
  nextOffset: number;
  relation: LatteTemplateRelation | null;
  suppressesAutoLayout: boolean;
}

const RELATION_TAG_NAMES: ReadonlySet<string> = new Set([
  "embed",
  "extends",
  "import",
  "layout",
]);
const PARENT_TAG_NAMES: ReadonlySet<string> = new Set(["extends", "layout"]);
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const STATIC_PATH = /^[A-Za-z0-9_./@-]+$/;
const PATH_CHARACTER = /[A-Za-z0-9_./@-]/;

/** Parses static `{extends}`/`{layout}`/`{import}`/`{embed}` template targets. */
export function parseLatteTemplateRelations(
  source: string,
): LatteTemplateRelations {
  const relations: LatteTemplateRelation[] = [];
  const masks = collectLatteMaskedRegions(source);
  let hasDynamicRelation = false;
  let hasParentTag = false;
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

    const tag = readRelationTag(source, index);

    if (!tag) {
      index += 1;
      continue;
    }

    index = tag.nextOffset;

    if (PARENT_TAG_NAMES.has(tag.kind) && tag.suppressesAutoLayout) {
      hasParentTag = true;
    }

    if (tag.isDynamic) {
      hasDynamicRelation = true;
    }

    if (tag.relation) {
      relations.push(tag.relation);
    }
  }

  return { hasDynamicRelation, hasParentTag, relations };
}

function readRelationTag(
  source: string,
  openBrace: number,
): RelationTagToken | null {
  let index = openBrace + 1;

  if (source[index] === "/") {
    return null;
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

  if (!RELATION_TAG_NAMES.has(name)) {
    return null;
  }

  const kind = name as LatteTemplateRelationKind;
  const next = source[index] ?? "";

  if (next !== "}" && !isWhitespace(next)) {
    return null;
  }

  const targetStart = skipInlineWhitespace(source, index);

  return readRelationTarget(source, kind, targetStart);
}

function readRelationTarget(
  source: string,
  kind: LatteTemplateRelationKind,
  targetStart: number,
): RelationTagToken {
  const quote = source[targetStart] ?? "";

  if (quote === "'" || quote === '"') {
    return readQuotedRelationTarget(source, kind, targetStart);
  }

  return readBareRelationTarget(source, kind, targetStart);
}

function readQuotedRelationTarget(
  source: string,
  kind: LatteTemplateRelationKind,
  quoteStart: number,
): RelationTagToken {
  const quoteEnd = quotedEnd(source, quoteStart);

  if (quoteEnd === null) {
    return {
      isDynamic: true,
      kind,
      nextOffset: quoteStart + 1,
      relation: null,
      suppressesAutoLayout: true,
    };
  }

  const path = source.slice(quoteStart + 1, quoteEnd);

  if (!isStaticRelationPath(path)) {
    return {
      isDynamic: true,
      kind,
      nextOffset: quoteEnd + 1,
      relation: null,
      suppressesAutoLayout: true,
    };
  }

  return {
    isDynamic: false,
    kind,
    nextOffset: quoteEnd + 1,
    relation: {
      kind,
      path,
      pathSpan: { end: quoteEnd, start: quoteStart + 1 },
    },
    suppressesAutoLayout: true,
  };
}

function readBareRelationTarget(
  source: string,
  kind: LatteTemplateRelationKind,
  targetStart: number,
): RelationTagToken {
  let index = targetStart;

  while (index < source.length && PATH_CHARACTER.test(source[index] ?? "")) {
    index += 1;
  }

  const token = source.slice(targetStart, index);
  const nextOffset = Math.max(index, targetStart + 1);

  if (token === "auto") {
    return {
      isDynamic: false,
      kind,
      nextOffset,
      relation: null,
      suppressesAutoLayout: false,
    };
  }

  if (token === "none") {
    return {
      isDynamic: false,
      kind,
      nextOffset,
      relation: null,
      suppressesAutoLayout: true,
    };
  }

  if (
    token.length === 0 ||
    !isStaticRelationPath(token) ||
    !looksLikeFilePath(token)
  ) {
    return {
      isDynamic: true,
      kind,
      nextOffset,
      relation: null,
      suppressesAutoLayout: true,
    };
  }

  return {
    isDynamic: false,
    kind,
    nextOffset,
    relation: {
      kind,
      path: token,
      pathSpan: { end: index, start: targetStart },
    },
    suppressesAutoLayout: true,
  };
}

function isStaticRelationPath(path: string): boolean {
  return path.length > 0 && STATIC_PATH.test(path) && !path.includes("::");
}

function looksLikeFilePath(path: string): boolean {
  return path.endsWith(".latte") || path.includes("/") || path.startsWith("@");
}

function quotedEnd(source: string, quoteStart: number): number | null {
  const quote = source[quoteStart];
  let index = quoteStart + 1;

  while (index < source.length) {
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

function skipInlineWhitespace(source: string, start: number): number {
  let index = start;

  while (isWhitespace(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
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
