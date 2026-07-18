import type {
  LanguageServerFeaturesGateway,
  LanguageServerPosition,
} from "../domain/languageServerFeatures";
import { workspacePathFromLanguageServerUri } from "../domain/languageServerFeatures";
import {
  auditPhpChangeSignatureReferenceCoverage,
  inspectPhpChangeSignatureCompletenessTarget,
  inspectPhpChangeSignatureDeclaration,
  inspectPhpChangeSignatureReferenceShape,
  type PhpChangeSignatureDocument,
  type PhpChangeSignatureReference,
} from "../domain/phpChangeSignature";
import {
  initialPhpChangeSignatureRows,
  validatePhpChangeSignatureRows,
  type PhpChangeSignatureFormRow,
} from "../domain/phpChangeSignatureForm";
import { createWorkspaceRootFromPath } from "../domain/workspacePath";
import type { PhpCodeActionWorkspaceEditApplier } from "./phpCodeActionTypes";
import { PhpChangeSignatureTransaction } from "./phpChangeSignatureTransaction";

export type PhpChangeSignatureWorkflowRejection = {
  kind: "rejected";
  message: string;
  reason: string;
};

export type PhpChangeSignatureWorkspaceEditApplier =
  PhpCodeActionWorkspaceEditApplier;

export interface PhpChangeSignaturePreparedSession {
  declaration: PhpChangeSignatureReference;
  documents: readonly PhpChangeSignatureDocument[];
  references: readonly PhpChangeSignatureReference[];
  rootPath: string;
  rows: readonly PhpChangeSignatureFormRow[];
  resolution: { complete: true; dynamicOrAmbiguous: false };
  workspaceEditApplier?: PhpChangeSignatureWorkspaceEditApplier;
}

export interface PhpChangeSignatureWorkflowPorts {
  applyWorkspaceEdit: PhpChangeSignatureWorkspaceEditApplier;
  currentRootPath(): string | null;
  flushDocument(path: string): Promise<void>;
  getOpenDocument(path: string): PhpChangeSignatureDocument | null;
  isWorkspaceTrusted(): boolean;
  isReferenceIndexComplete(rootPath: string): boolean;
  languageServer: Pick<LanguageServerFeaturesGateway, "references">;
  notifyClosedDocumentsChanged(
    rootPath: string,
    paths: string[],
  ): Promise<void>;
  readClosedDocument(path: string): Promise<PhpChangeSignatureDocument | null>;
  searchReferencePaths(
    rootPath: string,
    callableName: string,
  ): Promise<{ complete: boolean; paths: readonly string[] }>;
  subscribeChangedDocuments(
    listener: (paths: readonly string[]) => void,
  ): () => void;
}

export class PhpChangeSignatureWorkflow {
  constructor(private readonly ports: PhpChangeSignatureWorkflowPorts) {}

  async prepare(request: {
    applyWorkspaceEdit?: PhpChangeSignatureWorkspaceEditApplier;
    offset: number;
    path: string;
    rootPath: string;
  }): Promise<
    PhpChangeSignaturePreparedSession | PhpChangeSignatureWorkflowRejection
  > {
    if (!this.ports.isWorkspaceTrusted()) {
      return rejection(
        "untrustedWorkspace",
        "Trust this workspace before changing a PHP signature.",
      );
    }
    if (this.ports.currentRootPath() !== request.rootPath) {
      return rejection(
        "inactiveWorkspace",
        "The active project changed. Open Change Signature again.",
      );
    }
    const sourceDocument = this.ports.getOpenDocument(request.path);
    if (!sourceDocument) {
      return rejection(
        "closedDocument",
        "The target must be open before changing its signature.",
      );
    }
    if (!this.ports.isReferenceIndexComplete(request.rootPath)) {
      return rejection(
        "incompleteReferenceIndex",
        "Change Signature needs a completed, error-free workspace index. Wait for indexing to finish and try again.",
      );
    }

    await this.ports.flushDocument(request.path);
    if (this.ports.currentRootPath() !== request.rootPath) {
      return rejection(
        "inactiveWorkspace",
        "The active project changed while references were loading.",
      );
    }

    const root = createWorkspaceRootFromPath(request.rootPath);
    if (!root.ok)
      return rejection("invalidWorkspace", "The workspace path is not valid.");
    const locations = await this.ports.languageServer.references(
      request.rootPath,
      {
        path: request.path,
        ...positionAt(sourceDocument.content, request.offset),
      },
    );
    if (this.ports.currentRootPath() !== request.rootPath) {
      return rejection(
        "inactiveWorkspace",
        "The active project changed while references were loading.",
      );
    }
    if (!this.ports.isWorkspaceTrusted()) {
      return rejection(
        "untrustedWorkspace",
        "Workspace trust changed while references were loading.",
      );
    }
    if (!this.ports.isReferenceIndexComplete(request.rootPath)) {
      return rejection(
        "incompleteReferenceIndex",
        "The workspace index changed while references were loading. Open Change Signature again after indexing completes.",
      );
    }
    const currentSourceDocument = this.ports.getOpenDocument(request.path);
    if (
      !currentSourceDocument ||
      currentSourceDocument.version !== sourceDocument.version ||
      currentSourceDocument.content !== sourceDocument.content
    ) {
      return rejection(
        "staleDocument",
        "The declaration changed while references were loading. Open Change Signature again.",
      );
    }

    const candidateLocations = [
      { path: request.path, position: null as LanguageServerPosition | null },
      ...locations.flatMap((location) => {
        const path = workspacePathFromLanguageServerUri(
          root.value,
          location.uri,
        );
        if (!path) return [];
        return [
          {
            path: path.nativePath,
            position: location.range.start,
          },
        ];
      }),
    ];
    const documentEntries = await Promise.all(
      [...new Set(candidateLocations.map(({ path }) => path))].map(
        async (path) =>
          [
            path,
            this.ports.getOpenDocument(path) ??
              (await this.ports.readClosedDocument(path)),
          ] as const,
      ),
    );
    if (
      this.ports.currentRootPath() !== request.rootPath ||
      !this.ports.isWorkspaceTrusted()
    ) {
      return rejection(
        "inactiveWorkspace",
        "The active or trusted project changed while files were loading.",
      );
    }
    const documentsByPath = new Map(documentEntries);
    const unreadablePath = documentEntries.find(
      ([, document]) => !document,
    )?.[0];
    if (unreadablePath) {
      return rejection(
        "unreadableDocument",
        `Codevo could not read ${unreadablePath} safely.`,
      );
    }
    const candidates = candidateLocations.map(({ path, position }) => {
      const document = documentsByPath.get(path)!;
      return {
        offset: position
          ? offsetAt(document!.content, position)
          : request.offset,
        path,
      };
    });

    const uniqueCandidates = [
      ...new Map(
        candidates.map((item) => [`${item.path}:${item.offset}`, item]),
      ).values(),
    ];
    let declaration: PhpChangeSignatureReference | null = null;
    let declarationParameters: ReturnType<
      typeof inspectPhpChangeSignatureDeclaration
    > = null;
    for (const candidate of uniqueCandidates) {
      const document = documentsByPath.get(candidate.path);
      const inspected = document
        ? inspectPhpChangeSignatureDeclaration(
            document.content,
            candidate.offset,
          )
        : null;
      if (!inspected) continue;
      if (declaration) {
        return rejection(
          "ambiguousDeclaration",
          "More than one declaration matched this symbol.",
        );
      }
      declaration = { ...candidate, role: "declaration" };
      declarationParameters = inspected;
    }
    if (!declaration || !declarationParameters) {
      return rejection(
        "missingDeclaration",
        "Codevo could not resolve this callable to one PHP declaration.",
      );
    }
    const completenessTarget = inspectPhpChangeSignatureCompletenessTarget(
      documentsByPath.get(declaration.path)!.content,
      declaration.offset,
    );
    if (completenessTarget.kind === "rejected") {
      return rejection(
        completenessTarget.reason,
        completenessTarget.reason === "hierarchyAmbiguity"
          ? "Change Signature cannot prove this virtual method hierarchy is complete. Use a private or final method, or a method on a final class."
          : "Change Signature supports only statically declared PHP functions and methods.",
      );
    }

    const search = await this.ports.searchReferencePaths(
      request.rootPath,
      completenessTarget.name,
    );
    if (
      this.ports.currentRootPath() !== request.rootPath ||
      !this.ports.isWorkspaceTrusted() ||
      !this.ports.isReferenceIndexComplete(request.rootPath)
    ) {
      return rejection(
        "inactiveWorkspace",
        "The active project or its index changed during reference verification.",
      );
    }
    if (!search.complete) {
      return rejection(
        "incompleteReferenceSearch",
        "Change Signature could not inspect every matching PHP file. Narrow or finish indexing the workspace and try again.",
      );
    }
    const missingSearchPaths = search.paths.filter(
      (path) => !documentsByPath.has(path),
    );
    const searchEntries = await Promise.all(
      missingSearchPaths.map(
        async (path) =>
          [
            path,
            this.ports.getOpenDocument(path) ??
              (await this.ports.readClosedDocument(path)),
          ] as const,
      ),
    );
    if (
      this.ports.currentRootPath() !== request.rootPath ||
      !this.ports.isWorkspaceTrusted() ||
      !this.ports.isReferenceIndexComplete(request.rootPath)
    ) {
      return rejection(
        "inactiveWorkspace",
        "The active project or its index changed while matching files were read.",
      );
    }
    const unreadableSearchPath = searchEntries.find(
      ([, document]) => !document,
    )?.[0];
    if (unreadableSearchPath) {
      return rejection(
        "unreadableDocument",
        `Codevo could not inspect ${unreadableSearchPath} for a complete refactoring.`,
      );
    }
    for (const [path, document] of searchEntries) {
      documentsByPath.set(path, document);
    }

    const coverageCandidates = new Map<string, number[]>();
    for (const candidate of uniqueCandidates) {
      const offsets = coverageCandidates.get(candidate.path) ?? [];
      offsets.push(candidate.offset);
      coverageCandidates.set(candidate.path, offsets);
    }
    for (const path of search.paths) {
      const document = documentsByPath.get(path);
      if (!document) continue;
      const coverage = auditPhpChangeSignatureReferenceCoverage(
        document.content,
        completenessTarget.name,
        coverageCandidates.get(path) ?? [],
      );
      if (coverage.complete) continue;
      return rejection(
        coverage.reason === "dynamicCallable"
          ? "dynamicOrAmbiguousReference"
          : "incompleteReferenceSet",
        coverage.reason === "dynamicCallable"
          ? "A callable array or dynamic callable prevents a complete Change Signature refactoring."
          : "The language server omitted a static declaration or call site, so Change Signature stopped without modifying files.",
      );
    }

    const unsupportedReference = uniqueCandidates.find((candidate) => {
      if (
        candidate.path === declaration.path &&
        candidate.offset === declaration.offset
      ) {
        return false;
      }
      const document = documentsByPath.get(candidate.path);
      if (!document) return true;
      return (
        inspectPhpChangeSignatureReferenceShape(
          document.content,
          candidate.offset,
        ) !== "directCall"
      );
    });
    if (unsupportedReference) {
      return rejection(
        "dynamicOrAmbiguousReference",
        "A dynamic call, callable array, first-class callable, or ambiguous declaration prevents a complete Change Signature refactoring.",
      );
    }

    const paths = [...documentsByPath.keys()];
    const documents = paths.map((path) => documentsByPath.get(path)!);
    if (
      documents.some(
        (document) =>
          !document || (document.version === null && !document.contentHash),
      )
    ) {
      return rejection(
        "unversionedDocument",
        "Every closed file needs a trusted native snapshot before applying this refactoring.",
      );
    }
    const references = uniqueCandidates
      .filter(
        (candidate) =>
          candidate.path !== declaration.path ||
          candidate.offset !== declaration.offset,
      )
      .map((candidate) => ({ ...candidate, role: "call" as const }));

    return {
      declaration,
      documents,
      references,
      rootPath: request.rootPath,
      rows: initialPhpChangeSignatureRows(declarationParameters.parameters),
      resolution: { complete: true, dynamicOrAmbiguous: false },
      workspaceEditApplier: request.applyWorkspaceEdit,
    };
  }

  plan(
    session: PhpChangeSignaturePreparedSession,
    rows: readonly PhpChangeSignatureFormRow[],
  ) {
    const validation = validatePhpChangeSignatureRows(rows);
    if (validation.kind === "invalid") return validation;
    const transaction = PhpChangeSignatureTransaction.plan({
      declaration: session.declaration,
      documents: session.documents,
      parameters: validation.parameters,
      references: session.references,
      resolution: session.resolution,
      rootPath: session.rootPath,
    });
    if (!(transaction instanceof PhpChangeSignatureTransaction)) {
      const reason =
        transaction.kind === "rejected"
          ? transaction.reason
          : "invalidTransaction";
      return { kind: "invalid" as const, message: rejectionMessage(reason) };
    }
    return {
      kind: "ready" as const,
      preview: transaction.preview,
      transaction,
    };
  }

  async apply(
    session: PhpChangeSignaturePreparedSession,
    rows: readonly PhpChangeSignatureFormRow[],
  ) {
    if (!this.ports.isWorkspaceTrusted()) {
      return {
        kind: "invalid" as const,
        message: "Workspace trust changed. No files were modified.",
      };
    }
    const plan = this.plan(session, rows);
    if (plan.kind !== "ready") return plan;
    const currentRootPath = this.ports.currentRootPath();
    if (!currentRootPath)
      return { kind: "invalid" as const, message: "No project is active." };
    const currentOpenDocuments = session.documents
      .filter((document) => document.version !== null)
      .map((document) => this.ports.getOpenDocument(document.path))
      .filter(Boolean) as PhpChangeSignatureDocument[];
    const commit = plan.transaction.commit({
      currentOpenDocuments,
      currentRootPath,
    });
    if (commit.kind === "rejected") {
      return {
        kind: "invalid" as const,
        message: rejectionMessage(commit.reason),
      };
    }
    if (!commit.action.workspaceEdit) {
      return {
        kind: "invalid" as const,
        message: "The refactoring produced no workspace edit.",
      };
    }
    const applyWorkspaceEdit =
      session.workspaceEditApplier ?? this.ports.applyWorkspaceEdit;
    const decision = await applyWorkspaceEdit(
      commit.action.workspaceEdit,
      session.rootPath,
      currentOpenDocuments.map((document) => document.path),
      commit.expectedClosedFileHashes,
    );
    if (decision.kind === "rejected") {
      return {
        kind: "invalid" as const,
        message: rejectionMessage(decision.reason),
      };
    }
    const changedPaths = [
      ...new Set(commit.preview.edits.map(({ path }) => path)),
    ];
    const changedOpenPaths = changedPaths.filter((path) =>
      currentOpenDocuments.some((document) => document.path === path),
    );
    await Promise.all(
      changedOpenPaths.map((path) => this.ports.flushDocument(path)),
    );
    await this.ports.notifyClosedDocumentsChanged(
      session.rootPath,
      changedPaths.filter((path) => !changedOpenPaths.includes(path)),
    );
    return { kind: "applied" as const };
  }
}

function rejection(
  reason: string,
  message: string,
): PhpChangeSignatureWorkflowRejection {
  return { kind: "rejected", message, reason };
}

function rejectionMessage(reason: string): string {
  const messages: Record<string, string> = {
    inactiveWorkspace: "The active project changed. No files were modified.",
    incompleteReferenceSet: "Not every call site could be resolved safely.",
    incompleteReferenceIndex:
      "Change Signature needs a completed, error-free workspace index.",
    incompleteReferenceSearch:
      "Change Signature could not inspect every matching PHP file.",
    hierarchyAmbiguity:
      "Change Signature cannot prove this virtual method hierarchy is complete.",
    dynamicOrAmbiguousReference:
      "A dynamic or ambiguous call site prevents a complete refactoring.",
    atomicWorkspaceEditUnavailable:
      "Atomic closed-file edits are unavailable. No files were modified.",
    staleDocument:
      "An affected document changed. Reopen Change Signature and try again.",
    staleDocumentVersion:
      "An affected editor buffer changed. No files were modified.",
    unversionedDocument:
      "A closed file could not be captured with a trusted content hash.",
    untrustedWorkspace: "Trust this workspace before changing its signature.",
  };
  return (
    messages[reason] ?? `Change Signature was rejected safely (${reason}).`
  );
}

function positionAt(source: string, offset: number): LanguageServerPosition {
  const bounded = Math.max(0, Math.min(offset, source.length));
  const lines = source.slice(0, bounded).split("\n");
  return {
    character: lines[lines.length - 1]?.length ?? 0,
    line: lines.length - 1,
  };
}

function offsetAt(source: string, position: LanguageServerPosition): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let line = 0; line < Math.min(position.line, lines.length); line += 1) {
    offset += lines[line].length + 1;
  }
  return Math.min(source.length, offset + Math.max(0, position.character));
}
