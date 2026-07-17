import {
  parseLatteTemplateRelations,
  type LatteTemplateRelation,
  type LatteTemplateRelationKind,
} from "../domain/latteBlockGraph";
import type { LatteBlockSourceSpan } from "../domain/latteBlockSyntax";
import {
  latteLayoutCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import {
  latteBlockSymbolOccurrences,
  type LatteBlockSymbolOccurrence,
} from "./latteBlockSymbols";

export interface LatteCrossFileBlockDependencies {
  isRequestedRootActive(): boolean;
  readTemplateFile(relativePath: string): Promise<string | null>;
}

export interface LatteTemplateGraphDocument {
  relativePath: string;
  source: string;
  via?: LatteTemplateRelationKind;
}

export interface LatteCrossFileBlockDefinition {
  document: LatteTemplateGraphDocument;
  span: LatteBlockSourceSpan;
}

export interface LatteCrossFileBlockOccurrence {
  document: LatteTemplateGraphDocument;
  occurrence: LatteBlockSymbolOccurrence;
}

export const LATTE_BLOCK_GRAPH_MAX_DEPTH = 4;
export const LATTE_BLOCK_GRAPH_MAX_DOCUMENTS = 12;

const MAX_AUTO_LAYOUT_PROBES = 8;
const MAX_GRAPH_DOCUMENT_LENGTH = 1_000_000;

interface QueuedDocument {
  depth: number;
  document: LatteTemplateGraphDocument;
}

interface RelationCandidateGroup {
  candidates: string[];
  kind: LatteTemplateRelationKind;
}

const DEFINITION_RELATION_PRIORITY: Record<
  LatteTemplateRelationKind,
  number
> = {
  embed: 3,
  extends: 1,
  import: 2,
  layout: 1,
};

/**
 * Collects the start template plus the templates it directly relates to through
 * `{import}` / `{embed}` / `{extends}` / `{layout}` (and the conventional
 * `@layout.latte` lookup for the start template), breadth-first and
 * nearest-first. Bounded by depth and document count; cycle-safe. Resolves to
 * `null` when the requested workspace root goes stale mid-traversal.
 */
export async function collectLatteTemplateGraphDocuments(
  deps: LatteCrossFileBlockDependencies,
  startRelativePath: string,
  startSource: string,
): Promise<LatteTemplateGraphDocument[] | null> {
  const startDocument = { relativePath: startRelativePath, source: startSource };
  const documents: LatteTemplateGraphDocument[] = [startDocument];
  const visited = new Set([startRelativePath]);
  const queue: QueuedDocument[] = [{ depth: 0, document: startDocument }];

  while (queue.length > 0) {
    const queued = queue.shift();

    if (!queued || queued.depth >= LATTE_BLOCK_GRAPH_MAX_DEPTH) {
      continue;
    }

    const candidateGroups = relationCandidateGroups(
      queued.document,
      queued.depth === 0,
    );

    for (const group of candidateGroups) {
      if (documents.length >= LATTE_BLOCK_GRAPH_MAX_DOCUMENTS) {
        return documents;
      }

      const resolved = await resolveFirstExistingDocument(
        deps,
        group,
        visited,
      );

      if (resolved === "stale") {
        return null;
      }

      if (!resolved) {
        continue;
      }

      documents.push(resolved);
      queue.push({ depth: queued.depth + 1, document: resolved });
    }
  }

  return documents;
}

export function latteCrossFileBlockDefinition(
  documents: LatteTemplateGraphDocument[],
  name: string,
): LatteCrossFileBlockDefinition | null {
  for (const document of definitionOrderedDocuments(documents)) {
    if (isOversizedDocument(document)) {
      continue;
    }

    const declaration = latteBlockSymbolOccurrences(document.source, name).find(
      (occurrence) => occurrence.kind === "declaration",
    );

    if (declaration) {
      return { document, span: declaration.span };
    }
  }

  return null;
}

export function latteCrossFileBlockOccurrences(
  documents: LatteTemplateGraphDocument[],
  name: string,
): LatteCrossFileBlockOccurrence[] {
  return documents
    .filter((document) => !isOversizedDocument(document))
    .flatMap((document) =>
      latteBlockSymbolOccurrences(document.source, name).map((occurrence) => ({
        document,
        occurrence,
      })),
    );
}

export function latteWorkspaceRelativePath(
  rootPath: string,
  path: string,
): string | null {
  const root = normalizeSlashes(rootPath).replace(/\/+$/, "");
  const normalizedPath = normalizeSlashes(path);

  if (root.length === 0 || !normalizedPath.startsWith(`${root}/`)) {
    return null;
  }

  const relative = normalizedPath.slice(root.length + 1);

  return relative.length > 0 ? relative : null;
}

export function joinLatteWorkspacePath(
  rootPath: string,
  relativePath: string,
): string {
  return `${rootPath.replace(/\/+$/, "")}/${relativePath}`;
}

function relationCandidateGroups(
  document: LatteTemplateGraphDocument,
  isStartDocument: boolean,
): RelationCandidateGroup[] {
  if (isOversizedDocument(document)) {
    return [];
  }

  const parsed = parseLatteTemplateRelations(document.source);
  const ordered = [
    ...relationsOfKind(parsed.relations, "import"),
    ...relationsOfKind(parsed.relations, "embed"),
    ...relationsOfKind(parsed.relations, "extends"),
    ...relationsOfKind(parsed.relations, "layout"),
  ];
  const groups: RelationCandidateGroup[] = ordered.map((relation) => ({
    candidates: resolveLatteTemplateCandidatePaths(
      relation.path,
      document.relativePath,
    ),
    kind: relation.kind,
  }));

  if (isStartDocument && shouldProbeAutoLayout(parsed, ordered)) {
    groups.push({
      candidates: latteLayoutCandidatePaths(document.relativePath).slice(
        0,
        MAX_AUTO_LAYOUT_PROBES,
      ),
      kind: "layout",
    });
  }

  return groups.filter((group) => group.candidates.length > 0);
}

function shouldProbeAutoLayout(
  parsed: { hasParentTag: boolean },
  relations: LatteTemplateRelation[],
): boolean {
  if (parsed.hasParentTag) {
    return false;
  }

  return !relations.some(
    (relation) => relation.kind === "extends" || relation.kind === "layout",
  );
}

function relationsOfKind(
  relations: LatteTemplateRelation[],
  kind: LatteTemplateRelation["kind"],
): LatteTemplateRelation[] {
  return relations.filter((relation) => relation.kind === kind);
}

async function resolveFirstExistingDocument(
  deps: LatteCrossFileBlockDependencies,
  group: RelationCandidateGroup,
  visited: Set<string>,
): Promise<LatteTemplateGraphDocument | "stale" | null> {
  for (const relativePath of group.candidates) {
    if (visited.has(relativePath)) {
      return null;
    }

    const source = await deps.readTemplateFile(relativePath);

    if (!deps.isRequestedRootActive()) {
      return "stale";
    }

    if (source === null || source.length > MAX_GRAPH_DOCUMENT_LENGTH) {
      continue;
    }

    visited.add(relativePath);

    return { relativePath, source, via: group.kind };
  }

  return null;
}

function definitionOrderedDocuments(
  documents: LatteTemplateGraphDocument[],
): LatteTemplateGraphDocument[] {
  return [...documents].sort(
    (left, right) => definitionPriority(left) - definitionPriority(right),
  );
}

function definitionPriority(document: LatteTemplateGraphDocument): number {
  if (!document.via) {
    return 0;
  }

  return DEFINITION_RELATION_PRIORITY[document.via];
}

function isOversizedDocument(document: LatteTemplateGraphDocument): boolean {
  return document.source.length > MAX_GRAPH_DOCUMENT_LENGTH;
}

function normalizeSlashes(path: string): string {
  return path.split("\\").join("/");
}
