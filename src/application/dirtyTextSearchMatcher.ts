import type {
  DirtyTextSearchComputationRequest,
  DirtyTextSearchComputationResponse,
  DirtyTextSearchLimitation,
} from "./dirtyTextSearchComputation";
import {
  DIRTY_TEXT_SEARCH_MAX_AGGREGATE_BYTES,
  DIRTY_TEXT_SEARCH_MAX_DOCUMENT_BYTES,
  DIRTY_TEXT_SEARCH_MAX_RESPONSE_BYTES,
  DIRTY_TEXT_SEARCH_MAX_RESULTS,
  DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS,
} from "./dirtyTextSearchComputation";
import type { TextSearchOptions, TextSearchResult } from "../domain/workspace";

export interface DirtyTextSearchRuntimeBudget {
  readonly hasTimeRemaining: () => boolean;
  readonly utf8ByteLength: (value: string) => number;
}

const RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024;

export function computeDirtyTextSearch(
  request: DirtyTextSearchComputationRequest,
  budget: DirtyTextSearchRuntimeBudget,
): DirtyTextSearchComputationResponse {
  const limitations = new Set<DirtyTextSearchLimitation>(request.preflightLimitations);
  const results: TextSearchResult[] = [];
  const limit = Math.min(Math.max(1, Math.floor(request.limit)), DIRTY_TEXT_SEARCH_MAX_RESULTS);
  // The native disk search uses Rust's linear-time regex engine and Unicode
  // word-boundary semantics. JavaScript RegExp accepts a different language
  // (including catastrophic backtracking) and its `\b` is not equivalent.
  // Until both paths share one matcher, fail closed for dirty documents rather
  // than presenting approximate rows as authoritative.
  if (request.options.isRegex || request.options.wholeWord) {
    limitations.add("unsupported-query-semantics");
    return response(request, results, limitations);
  }
  // File masks and ignore files are owned by the native search engine. With an
  // empty mask the product policy explicitly searches every open dirty buffer;
  // a non-empty mask cannot be reproduced truthfully in this worker yet.
  if (request.options.fileMask.trim()) {
    limitations.add("unsupported-file-mask");
    return response(request, results, limitations);
  }
  const matcher = createMatcher(request.query, request.options);
  let aggregateBytes = 0;
  let responseBytes =
    RESPONSE_ENVELOPE_RESERVE_BYTES + budget.utf8ByteLength(JSON.stringify(request.dirtyPaths));

  if (!matcher) {
    return response(request, results, limitations);
  }

  search: for (const document of request.documents) {
    if (!budget.hasTimeRemaining()) {
      limitations.add("time-limit");
      break;
    }
    const documentBytes = budget.utf8ByteLength(document.content);
    if (documentBytes > DIRTY_TEXT_SEARCH_MAX_DOCUMENT_BYTES) {
      limitations.add("document-too-large");
      continue;
    }
    if (aggregateBytes + documentBytes > DIRTY_TEXT_SEARCH_MAX_AGGREGATE_BYTES) {
      limitations.add("aggregate-input-limit");
      continue;
    }
    aggregateBytes += documentBytes;

    let lineNumber = 1;
    let lineStart = 0;
    while (lineStart <= document.content.length) {
      if (!budget.hasTimeRemaining()) {
        limitations.add("time-limit");
        break search;
      }
      const newline = document.content.indexOf("\n", lineStart);
      const lineEnd = newline < 0 ? document.content.length : newline;
      const contentEnd =
        lineEnd > lineStart && document.content.charCodeAt(lineEnd - 1) === 13
          ? lineEnd - 1
          : lineEnd;
      const line = document.content.slice(lineStart, contentEnd);
      matcher.lastIndex = 0;
      let codePoints: string[] | null = null;
      const conversion = createUtf16ToCodePointCursor();

      while (true) {
        if (!budget.hasTimeRemaining()) {
          limitations.add("time-limit");
          break search;
        }
        const match = matcher.exec(line);
        if (!match) {
          break;
        }
        if (results.length >= limit) {
          limitations.add("result-limit");
          break search;
        }
        const matchText = match[0] ?? "";
        const matchUtf16Start = match.index;
        const matchUtf16End = matchUtf16Start + matchText.length;
        codePoints ??= Array.from(line);
        const matchStart = conversion.convert(line, matchUtf16Start);
        const matchEnd = conversion.convert(line, matchUtf16End);
        const projection = projectMatchLine(codePoints, matchStart, matchEnd);
        const result: TextSearchResult = {
          // Monaco source columns are UTF-16 code-unit based.
          column: matchUtf16Start + 1,
          lineNumber,
          lineText: projection.lineText,
          matchEnd: projection.matchEnd,
          matchStart: projection.matchStart,
          matchTruncated: projection.matchTruncated,
          path: document.path,
          previewTruncated: projection.previewTruncated,
          relativePath: document.relativePath,
        };
        const resultBytes = budget.utf8ByteLength(JSON.stringify(result));
        if (responseBytes + resultBytes > DIRTY_TEXT_SEARCH_MAX_RESPONSE_BYTES) {
          limitations.add("response-limit");
          break search;
        }
        responseBytes += resultBytes;
        results.push(result);

        if (matchText.length === 0) {
          matcher.lastIndex = advanceUtf16CodePoint(line, matcher.lastIndex);
        }
      }

      if (newline < 0) {
        break;
      }
      lineStart = newline + 1;
      lineNumber += 1;
    }
  }

  return response(request, results, limitations);
}

function createMatcher(query: string, options: TextSearchOptions): RegExp | null {
  try {
    const literal = options.isRegex ? query : query.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    const pattern = options.wholeWord ? `\\b(?:${literal})\\b` : literal;
    return new RegExp(pattern, options.caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

function projectMatchLine(
  characters: readonly string[],
  matchStart: number,
  matchEnd: number,
): {
  readonly lineText: string;
  readonly matchEnd: number;
  readonly matchStart: number;
  readonly matchTruncated: boolean;
  readonly previewTruncated: boolean;
} {
  const boundedMatchStart = Math.min(Math.max(0, matchStart), characters.length);
  const boundedMatchEnd = Math.min(Math.max(boundedMatchStart, matchEnd), characters.length);
  if (characters.length <= DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS) {
    return {
      lineText: characters.join(""),
      matchEnd: boundedMatchEnd,
      matchStart: boundedMatchStart,
      matchTruncated: false,
      previewTruncated: false,
    };
  }

  const matchLength = boundedMatchEnd - boundedMatchStart;
  const matchTruncated = matchLength > DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS;
  const contextBudget = Math.max(0, DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS - matchLength);
  let previewStart = Math.max(0, boundedMatchStart - Math.floor(contextBudget / 2));
  let previewEnd = Math.min(
    characters.length,
    previewStart + DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS,
  );
  if (previewEnd - previewStart < DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS) {
    previewStart = Math.max(0, previewEnd - DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS);
  }
  if (!matchTruncated && previewEnd < boundedMatchEnd) {
    previewStart = Math.max(0, boundedMatchEnd - DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS);
    previewEnd = Math.min(characters.length, previewStart + DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS);
  }
  const projectedMatchStart = Math.max(0, boundedMatchStart - previewStart);
  const projectedMatchEnd = Math.min(
    previewEnd - previewStart,
    Math.max(projectedMatchStart, boundedMatchEnd - previewStart),
  );
  return {
    lineText: characters.slice(previewStart, previewEnd).join(""),
    matchEnd: projectedMatchEnd,
    matchStart: projectedMatchStart,
    matchTruncated,
    previewTruncated: true,
  };
}

function createUtf16ToCodePointCursor(): {
  convert(line: string, target: number): number;
} {
  let codePointOffset = 0;
  let utf16Offset = 0;
  return {
    convert(line, target) {
      while (utf16Offset < target) {
        const codePoint = line.codePointAt(utf16Offset);
        utf16Offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
        codePointOffset += 1;
      }
      return codePointOffset;
    },
  };
}

function advanceUtf16CodePoint(line: string, offset: number): number {
  if (offset >= line.length) {
    return line.length + 1;
  }
  const codePoint = line.codePointAt(offset);
  return offset + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function response(
  request: DirtyTextSearchComputationRequest,
  results: readonly TextSearchResult[],
  limitations: ReadonlySet<DirtyTextSearchLimitation>,
): DirtyTextSearchComputationResponse {
  return {
    authority: request.authority,
    dirtyPaths: request.dirtyPaths,
    limitations: [...limitations],
    results,
    truncated: limitations.size > 0,
  };
}
