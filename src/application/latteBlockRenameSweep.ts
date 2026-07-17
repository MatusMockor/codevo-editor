import { parseLatteTemplateRelations } from "../domain/latteBlockGraph";
import { collectLatteMaskedRegions } from "../domain/latteSyntax";
import {
  latteLayoutCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import {
  latteBlockSymbolOccurrences,
  type LatteBlockSymbolOccurrence,
} from "./latteBlockSymbols";

export interface LatteBlockRenameSweepPorts {
  isRequestedRootActive(): boolean;
  listTemplateFiles(): Promise<readonly string[] | null>;
  readTemplateFile(relativePath: string): Promise<string | null>;
}

export interface LatteBlockRenameSweepFile {
  occurrences: LatteBlockSymbolOccurrence[];
  relativePath: string;
  source: string;
}

export type LatteBlockRenameSweepResult =
  | { files: LatteBlockRenameSweepFile[]; kind: "swept" }
  | { kind: "rejected"; reason: string }
  | { kind: "unavailable" };

export const LATTE_RENAME_SWEEP_MAX_FILES = 2_000;
export const LATTE_RENAME_SWEEP_MAX_FILE_LENGTH = 1_000_000;

const SKIPPED_PATH_SEGMENTS = new Set(["node_modules", "vendor"]);
const MAX_AUTO_LAYOUT_PROBES = 8;
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const BLOCK_NAME_PART = /[A-Za-z0-9_.-]/;
const STALE_REASON =
  "The workspace changed while scanning Latte templates for the rename.";

interface TemplateRelationSummary {
  hasDynamicRelation: boolean;
  parents: string[];
}

interface BlockReferenceSummary {
  hasDynamicBlockReference: boolean;
  includeFromNames: Set<string>;
}

interface BlockReferenceTagScan {
  includeFromName: string | null;
  isDynamic: boolean;
  nextOffset: number;
}

/**
 * Contract: never returns a partial closure. Whenever completeness cannot be
 * guaranteed (dynamic relations or block names touching the closure, file or
 * size limits exceeded, stale root, unreadable anchor), the sweep rejects the
 * whole rename; a `null` template listing degrades to `unavailable`.
 */
export async function sweepLatteBlockRename(
  ports: LatteBlockRenameSweepPorts,
  anchorRelativePath: string,
  name: string,
): Promise<LatteBlockRenameSweepResult> {
  let listed: readonly string[] | null;

  try {
    listed = await ports.listTemplateFiles();
  } catch {
    return rejected("Listing workspace Latte templates failed.");
  }

  if (!ports.isRequestedRootActive()) {
    return rejected(STALE_REASON);
  }

  if (listed === null) {
    return { kind: "unavailable" };
  }

  const relativePaths = sweepCandidatePaths(listed, anchorRelativePath);

  if (relativePaths.length > LATTE_RENAME_SWEEP_MAX_FILES) {
    return rejected(
      `The workspace has more than ${LATTE_RENAME_SWEEP_MAX_FILES} Latte templates; the rename cannot be verified.`,
    );
  }

  const sourcesResult = await readSweepSources(
    ports,
    relativePaths,
    anchorRelativePath,
  );

  if (sourcesResult.kind === "rejected") {
    return sourcesResult;
  }

  const sources = sourcesResult.sources;
  const scannedPaths = [...sources.keys()];
  const relationsByPath = new Map<string, TemplateRelationSummary>(
    scannedPaths.map((path) => [
      path,
      templateRelationSummary(path, sources.get(path) ?? "", sources),
    ]),
  );
  const occurrencesByPath = new Map<string, LatteBlockSymbolOccurrence[]>(
    scannedPaths.map((path) => [
      path,
      latteBlockSymbolOccurrences(sources.get(path) ?? "", name),
    ]),
  );
  const chains = scannedPaths.map((path) => forwardChain(path, relationsByPath));
  const component = renameComponentPaths(
    chains,
    occurrencesByPath,
    anchorRelativePath,
  );
  const guard = sweepGuardRejection(
    name,
    scannedPaths,
    chains,
    component,
    sources,
    relationsByPath,
    occurrencesByPath,
  );

  if (guard) {
    return guard;
  }

  const files = orderedComponentFiles(
    component,
    anchorRelativePath,
    scannedPaths,
    sources,
    occurrencesByPath,
  );

  return { files, kind: "swept" };
}

function sweepCandidatePaths(
  listed: readonly string[],
  anchorRelativePath: string,
): string[] {
  const paths = new Set<string>([anchorRelativePath]);

  for (const path of listed) {
    const normalized = normalizeSlashes(path).replace(/^\/+/, "");

    if (!normalized.endsWith(".latte")) {
      continue;
    }

    if (
      normalized
        .split("/")
        .some((segment) => SKIPPED_PATH_SEGMENTS.has(segment))
    ) {
      continue;
    }

    paths.add(normalized);
  }

  return [...paths];
}

async function readSweepSources(
  ports: LatteBlockRenameSweepPorts,
  relativePaths: string[],
  anchorRelativePath: string,
): Promise<
  { kind: "read"; sources: Map<string, string> } | { kind: "rejected"; reason: string }
> {
  const sources = new Map<string, string>();

  for (const relativePath of relativePaths) {
    let source: string | null;

    try {
      source = await ports.readTemplateFile(relativePath);
    } catch {
      return rejected(`Template ${relativePath} could not be read.`);
    }

    if (!ports.isRequestedRootActive()) {
      return rejected(STALE_REASON);
    }

    if (source === null) {
      if (relativePath === anchorRelativePath) {
        return rejected(`Template ${relativePath} could not be read.`);
      }

      continue;
    }

    if (source.length > LATTE_RENAME_SWEEP_MAX_FILE_LENGTH) {
      return rejected(
        `Template ${relativePath} is too large to include in a verified rename.`,
      );
    }

    sources.set(relativePath, source);
  }

  if (!sources.has(anchorRelativePath)) {
    return rejected(`Template ${anchorRelativePath} could not be read.`);
  }

  return { kind: "read", sources };
}

function templateRelationSummary(
  relativePath: string,
  source: string,
  sources: Map<string, string>,
): TemplateRelationSummary {
  const parsed = parseLatteTemplateRelations(source);
  const parents: string[] = [];

  for (const relation of parsed.relations) {
    const parent = firstExistingCandidate(
      resolveLatteTemplateCandidatePaths(relation.path, relativePath),
      sources,
    );

    if (parent && parent !== relativePath) {
      parents.push(parent);
    }
  }

  if (shouldProbeAutoLayout(parsed)) {
    const layout = firstExistingCandidate(
      latteLayoutCandidatePaths(relativePath).slice(0, MAX_AUTO_LAYOUT_PROBES),
      sources,
    );

    if (layout && layout !== relativePath) {
      parents.push(layout);
    }
  }

  return {
    hasDynamicRelation: parsed.hasDynamicRelation,
    parents: [...new Set(parents)],
  };
}

function shouldProbeAutoLayout(parsed: {
  hasParentTag: boolean;
  relations: { kind: string }[];
}): boolean {
  if (parsed.hasParentTag) {
    return false;
  }

  return !parsed.relations.some(
    (relation) => relation.kind === "extends" || relation.kind === "layout",
  );
}

function firstExistingCandidate(
  candidates: string[],
  sources: Map<string, string>,
): string | null {
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

function forwardChain(
  start: string,
  relationsByPath: Map<string, TemplateRelationSummary>,
): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    if (current === undefined) {
      continue;
    }

    for (const parent of relationsByPath.get(current)?.parents ?? []) {
      if (visited.has(parent)) {
        continue;
      }

      visited.add(parent);
      queue.push(parent);
    }
  }

  return visited;
}

function renameComponentPaths(
  chains: Set<string>[],
  occurrencesByPath: Map<string, LatteBlockSymbolOccurrence[]>,
  anchorRelativePath: string,
): Set<string> {
  const nodes = new Set<string>([anchorRelativePath]);

  for (const [path, occurrences] of occurrencesByPath) {
    if (occurrences.length > 0) {
      nodes.add(path);
    }
  }

  const leaders = new Map<string, string>();
  const find = (path: string): string => {
    const leader = leaders.get(path);

    if (leader === undefined || leader === path) {
      leaders.set(path, path);
      return path;
    }

    const root = find(leader);
    leaders.set(path, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      leaders.set(leftRoot, rightRoot);
    }
  };

  for (const chain of chains) {
    const chainNodes = [...chain].filter((path) => nodes.has(path));
    const first = chainNodes[0];

    if (first === undefined) {
      continue;
    }

    for (const other of chainNodes.slice(1)) {
      union(first, other);
    }
  }

  const anchorLeader = find(anchorRelativePath);

  return new Set(
    [...nodes].filter((path) => find(path) === anchorLeader),
  );
}

function sweepGuardRejection(
  name: string,
  scannedPaths: string[],
  chains: Set<string>[],
  component: Set<string>,
  sources: Map<string, string>,
  relationsByPath: Map<string, TemplateRelationSummary>,
  occurrencesByPath: Map<string, LatteBlockSymbolOccurrence[]>,
): { kind: "rejected"; reason: string } | null {
  for (const path of scannedPaths) {
    const hasOccurrence = (occurrencesByPath.get(path)?.length ?? 0) > 0;

    if (hasOccurrence && relationsByPath.get(path)?.hasDynamicRelation) {
      return rejected(
        `Template ${path} uses a dynamic template relation; the rename cannot be verified.`,
      );
    }
  }

  const referenceSummaries = new Map<string, BlockReferenceSummary>();
  const referenceSummary = (path: string): BlockReferenceSummary => {
    const cached = referenceSummaries.get(path);

    if (cached) {
      return cached;
    }

    const summary = scanBlockReferences(sources.get(path) ?? "");
    referenceSummaries.set(path, summary);
    return summary;
  };

  for (const path of scannedPaths) {
    if (referenceSummary(path).includeFromNames.has(name)) {
      return rejected(
        `Template ${path} includes block "${name}" with a from clause; the rename cannot be verified.`,
      );
    }
  }

  for (let index = 0; index < scannedPaths.length; index += 1) {
    const chain = chains[index];

    if (!chain || ![...chain].some((path) => component.has(path))) {
      continue;
    }

    for (const member of chain) {
      if (referenceSummary(member).hasDynamicBlockReference) {
        return rejected(
          `Template ${member} references blocks dynamically; the rename cannot be verified.`,
        );
      }
    }
  }

  return null;
}

function orderedComponentFiles(
  component: Set<string>,
  anchorRelativePath: string,
  scannedPaths: string[],
  sources: Map<string, string>,
  occurrencesByPath: Map<string, LatteBlockSymbolOccurrence[]>,
): LatteBlockRenameSweepFile[] {
  const ordered = [
    anchorRelativePath,
    ...scannedPaths.filter((path) => path !== anchorRelativePath),
  ];

  return ordered.flatMap((path) => {
    if (!component.has(path)) {
      return [];
    }

    const occurrences = occurrencesByPath.get(path) ?? [];

    if (occurrences.length === 0) {
      return [];
    }

    return [
      {
        occurrences,
        relativePath: path,
        source: sources.get(path) ?? "",
      },
    ];
  });
}

function scanBlockReferences(source: string): BlockReferenceSummary {
  const summary: BlockReferenceSummary = {
    hasDynamicBlockReference: false,
    includeFromNames: new Set<string>(),
  };
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

    const scan = inspectBlockReferenceTag(source, index);

    if (!scan) {
      index += 1;
      continue;
    }

    if (scan.isDynamic) {
      summary.hasDynamicBlockReference = true;
    }

    if (scan.includeFromName !== null) {
      summary.includeFromNames.add(scan.includeFromName);
    }

    index = Math.max(scan.nextOffset, index + 1);
  }

  return summary;
}

function inspectBlockReferenceTag(
  source: string,
  openBrace: number,
): BlockReferenceTagScan | null {
  let index = openBrace + 1;

  if (!IDENTIFIER_START.test(source[index] ?? "")) {
    return null;
  }

  const nameStart = index;
  index += 1;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const tagName = source.slice(nameStart, index);

  if (tagName !== "block" && tagName !== "define" && tagName !== "include") {
    return null;
  }

  const next = source[index] ?? "";

  if (next !== "}" && !isWhitespace(next)) {
    return null;
  }

  index = skipInlineWhitespace(source, index);
  index = skipMarkerWord(
    source,
    index,
    tagName === "include" ? "block" : "local",
  );

  if (source[index] === "#") {
    index += 1;
  }

  const target = source[index] ?? "";

  if (target === "$") {
    return { includeFromName: null, isDynamic: true, nextOffset: index + 1 };
  }

  if (target === "'" || target === '"') {
    return inspectQuotedBlockTarget(source, tagName, index);
  }

  if (target === "" || target === "}" || target === "|") {
    return { includeFromName: null, isDynamic: false, nextOffset: index + 1 };
  }

  if (!IDENTIFIER_START.test(target)) {
    return { includeFromName: null, isDynamic: true, nextOffset: index + 1 };
  }

  const wordStart = index;
  index += 1;

  while (BLOCK_NAME_PART.test(source[index] ?? "")) {
    index += 1;
  }

  const word = source.slice(wordStart, index);

  return {
    includeFromName:
      tagName === "include" && hasFollowingFromClause(source, index)
        ? word
        : null,
    isDynamic: false,
    nextOffset: index,
  };
}

function inspectQuotedBlockTarget(
  source: string,
  tagName: string,
  quoteStart: number,
): BlockReferenceTagScan {
  const quoteEnd = lineBoundedQuoteEnd(source, quoteStart);

  if (quoteEnd === null) {
    return {
      includeFromName: null,
      isDynamic: true,
      nextOffset: quoteStart + 1,
    };
  }

  const literal = source.slice(quoteStart + 1, quoteEnd);

  if (literal.includes("$") || literal.includes("{")) {
    return { includeFromName: null, isDynamic: true, nextOffset: quoteEnd + 1 };
  }

  return {
    includeFromName:
      tagName === "include" && hasFollowingFromClause(source, quoteEnd + 1)
        ? literal
        : null,
    isDynamic: false,
    nextOffset: quoteEnd + 1,
  };
}

function hasFollowingFromClause(source: string, from: number): boolean {
  const start = skipInlineWhitespace(source, from);
  let index = start;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  return source.slice(start, index) === "from";
}

function skipMarkerWord(source: string, start: number, marker: string): number {
  let index = start;

  while (IDENTIFIER_PART.test(source[index] ?? "")) {
    index += 1;
  }

  if (source.slice(start, index) !== marker) {
    return start;
  }

  const afterMarker = skipInlineWhitespace(source, index);

  return afterMarker > index ? afterMarker : start;
}

function lineBoundedQuoteEnd(source: string, quoteStart: number): number | null {
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

function normalizeSlashes(path: string): string {
  return path.split("\\").join("/");
}

function rejected(reason: string): { kind: "rejected"; reason: string } {
  return { kind: "rejected", reason };
}
