import type {
  LanguageServerPosition,
  LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import {
  planPhpChangeSignature,
  type PhpChangeSignatureDocument,
  type PhpChangeSignatureParameter,
  type PhpChangeSignaturePreview,
  type PhpChangeSignatureReference,
} from "../domain/phpChangeSignature";
import {
  createWorkspaceRootFromPath,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";
import {
  allowedPhpChangeSignatureTarget,
  canonicalPhpChangeSignatureReference,
  type PhpChangeSignatureWorkspaceRejection,
  validatePhpChangeSignatureWorkspace,
} from "./phpChangeSignatureWorkspaceValidator";

export type PhpChangeSignatureTransactionRejection =
  | "inactiveWorkspace"
  | "invalidWorkspace"
  | "incompleteReferenceSet"
  | "staleDocument"
  | "unversionedDocument"
  | "unsupportedTarget"
  | PhpChangeSignatureWorkspaceRejection;

export type PhpChangeSignatureTransactionResult =
  | {
      action: PhpCodeActionDescriptor;
      expectedClosedFileHashes: Readonly<Record<string, string>>;
      kind: "ready";
      preview: PhpChangeSignaturePreview;
    }
  | {
      kind: "rejected";
      reason: PhpChangeSignatureTransactionRejection | string;
    };

/**
 * Captures a complete, immutable refactoring plan. Creation performs semantic
 * and syntax validation; commit performs workspace/version validation again.
 * The returned workspace edit is still applied by the shared transactional
 * workspace-edit gateway, so this module never mutates open models or files.
 */
export class PhpChangeSignatureTransaction {
  private constructor(
    private readonly root: WorkspaceRootDescriptor,
    private readonly documents: ReadonlyMap<string, PhpChangeSignatureDocument>,
    preview: PhpChangeSignaturePreview,
  ) {
    this.preview = immutablePreview(preview);
  }

  readonly preview: PhpChangeSignaturePreview;

  static plan(options: {
    declaration: PhpChangeSignatureReference;
    documents: readonly PhpChangeSignatureDocument[];
    parameters: readonly PhpChangeSignatureParameter[];
    references: readonly PhpChangeSignatureReference[];
    /** Attestation from the static reference/hierarchy resolver. */
    resolution: { complete: boolean; dynamicOrAmbiguous: boolean };
    rootPath: string;
  }): PhpChangeSignatureTransaction | PhpChangeSignatureTransactionResult {
    if (!options.resolution.complete || options.resolution.dynamicOrAmbiguous) {
      return { kind: "rejected", reason: "incompleteReferenceSet" };
    }
    const workspace = validatePhpChangeSignatureWorkspace(options);
    if (workspace.kind === "rejected") return workspace;

    const declaration = canonicalPhpChangeSignatureReference(
      workspace.root,
      options.declaration,
    );
    const references = options.references.map((reference) =>
      canonicalPhpChangeSignatureReference(workspace.root, reference),
    );
    if (!declaration || references.some((reference) => reference === null)) {
      return { kind: "rejected", reason: "unsupportedTarget" };
    }

    const result = planPhpChangeSignature({
      declaration,
      documents: [...workspace.documents.values()],
      parameters: options.parameters,
      references: references as PhpChangeSignatureReference[],
    });
    if (result.kind === "rejected") return result;

    return new PhpChangeSignatureTransaction(
      workspace.root,
      workspace.documents,
      result.preview,
    );
  }

  commit(options: {
    currentOpenDocuments: readonly PhpChangeSignatureDocument[];
    currentRootPath: string;
  }): PhpChangeSignatureTransactionResult {
    const currentRoot = createWorkspaceRootFromPath(options.currentRootPath);
    if (
      !currentRoot.ok ||
      currentRoot.value.workspaceId !== this.root.workspaceId ||
      currentRoot.value.nativePath !== this.root.nativePath
    ) {
      return { kind: "rejected", reason: "inactiveWorkspace" };
    }

    const currentByPath = new Map<string, PhpChangeSignatureDocument>();
    for (const document of options.currentOpenDocuments) {
      const path = allowedPhpChangeSignatureTarget(this.root, document.path);
      if (!path) continue;
      const existing = currentByPath.get(path.nativePath);
      if (
        existing &&
        (existing.content !== document.content ||
          existing.version !== document.version)
      ) {
        return { kind: "rejected", reason: "staleDocument" };
      }
      currentByPath.set(path.nativePath, document);
    }
    for (const [path, captured] of this.documents) {
      if (captured.version === null) continue;
      const current = currentByPath.get(path);
      if (
        !current ||
        current.content !== captured.content ||
        current.version !== captured.version
      ) {
        return { kind: "rejected", reason: "staleDocument" };
      }
    }

    const workspaceEdit = toWorkspaceEdit(this.preview, this.documents);
    const expectedClosedFileHashes = Object.fromEntries(
      [...this.documents].flatMap(([path, document]) =>
        document.version === null && document.contentHash
          ? [[path, document.contentHash] as const]
          : [],
      ),
    );
    return {
      action: {
        edits: [],
        kind: "refactor.rewrite",
        title: `Change signature to ${this.preview.signature}`,
        workspaceEdit,
        workspaceRoot: this.root.nativePath,
      },
      expectedClosedFileHashes,
      kind: "ready",
      preview: this.preview,
    };
  }
}

function immutablePreview(
  preview: PhpChangeSignaturePreview,
): PhpChangeSignaturePreview {
  const edits = preview.edits.map((edit) => Object.freeze({ ...edit }));
  return Object.freeze({ ...preview, edits: Object.freeze(edits) });
}

function toWorkspaceEdit(
  preview: PhpChangeSignaturePreview,
  documents: ReadonlyMap<string, PhpChangeSignatureDocument>,
): LanguageServerWorkspaceEdit {
  const changes: LanguageServerWorkspaceEdit["changes"] = {};
  const documentVersions: NonNullable<
    LanguageServerWorkspaceEdit["documentVersions"]
  > = {};
  for (const edit of preview.edits) {
    const document = documents.get(edit.path)!;
    const uri = fileUriFromPath(edit.path);
    (changes[uri] ??= []).push({
      newText: edit.text,
      range: {
        end: positionAt(document.content, edit.end),
        start: positionAt(document.content, edit.start),
      },
    });
    if (edit.version !== null) documentVersions[uri] = edit.version;
  }
  return { changes, documentVersions };
}

function positionAt(source: string, offset: number): LanguageServerPosition {
  const bounded = Math.max(0, Math.min(offset, source.length));
  const lines = source.slice(0, bounded).split("\n");
  return { character: lines[lines.length - 1].length, line: lines.length - 1 };
}
