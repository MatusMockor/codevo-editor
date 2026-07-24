import type * as Monaco from "monaco-editor";
import { debugUtf8ByteLength } from "../domain/debugEvaluationPolicy";
import { MAX_DEBUG_INLINE_SOURCE_BYTES } from "../domain/debugInlineValues";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";

export const MAX_DEBUG_INLINE_SOURCE_ADMISSIONS = 64;
export const MAX_DEBUG_INLINE_ADMISSION_SOURCE_BYTES =
  MAX_DEBUG_INLINE_SOURCE_ADMISSIONS * MAX_DEBUG_INLINE_SOURCE_BYTES;

type Admission =
  | {
      readonly kind: "admitted";
      readonly model: Monaco.editor.ITextModel;
      readonly ownerKey: string;
      readonly pauseGeneration: number;
      readonly path: string;
      readonly rootKey: string;
      readonly sessionId: number;
      readonly source: string;
      readonly sourceBytes: number;
    }
  | {
      readonly kind: "invalid";
      readonly ownerKey: string;
      readonly pauseGeneration: number;
      readonly path: string;
      readonly rootKey: string;
      readonly sessionId: number;
      readonly sourceBytes: 0;
    };

export class DebugInlineSourceAdmissionCoordinator {
  readonly #entries = new Map<string, Admission>();
  #sourceBytes = 0;

  constructor(
    readonly maximumEntries = MAX_DEBUG_INLINE_SOURCE_ADMISSIONS,
    readonly maximumSourceBytes = MAX_DEBUG_INLINE_ADMISSION_SOURCE_BYTES,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  get sourceBytes(): number {
    return this.#sourceBytes;
  }

  clear(): void {
    this.#entries.clear();
    this.#sourceBytes = 0;
  }

  beginOwner(owner: DebugInspectionOwner): void {
    for (const [key, entry] of this.#entries) {
      if (
        entry.rootKey === owner.rootKey &&
        (entry.sessionId !== owner.sessionId || entry.pauseGeneration !== owner.pauseGeneration)
      )
        this.#delete(key, entry);
    }
  }

  admit({
    dirty,
    model,
    modelSource,
    owner,
    path,
    source,
  }: {
    readonly dirty: boolean;
    readonly model: Monaco.editor.ITextModel;
    readonly modelSource: string;
    readonly owner: DebugInspectionOwner;
    readonly path: string;
    readonly source: string;
  }): boolean {
    this.beginOwner(owner);
    const ownerKey = admissionOwnerKey(owner);
    const key = JSON.stringify([ownerKey, path]);
    const existing = this.#entries.get(key);
    if (existing?.kind === "invalid") return false;
    if (
      existing?.kind === "admitted" &&
      (dirty ||
        existing.model !== model ||
        existing.source !== source ||
        existing.source !== modelSource)
    ) {
      this.#invalidate(key, existing, owner, ownerKey, path);
      return false;
    }
    if (existing?.kind === "admitted") return true;
    if (dirty || source !== modelSource) {
      this.#insertInvalid(key, owner, ownerKey, path);
      return false;
    }
    const sourceBytes = debugUtf8ByteLength(source);
    if (sourceBytes > MAX_DEBUG_INLINE_SOURCE_BYTES || sourceBytes > this.maximumSourceBytes) {
      this.#insertInvalid(key, owner, ownerKey, path);
      return false;
    }
    if (
      this.#entries.size >= this.maximumEntries ||
      this.#sourceBytes + sourceBytes > this.maximumSourceBytes
    )
      return false;
    const entry: Admission = {
      kind: "admitted",
      model,
      ownerKey,
      pauseGeneration: owner.pauseGeneration,
      path,
      rootKey: owner.rootKey,
      sessionId: owner.sessionId,
      source,
      sourceBytes,
    };
    this.#entries.set(key, entry);
    this.#sourceBytes += sourceBytes;
    return true;
  }

  #insertInvalid(key: string, owner: DebugInspectionOwner, ownerKey: string, path: string): void {
    if (this.#entries.size >= this.maximumEntries) return;
    this.#entries.set(key, {
      kind: "invalid",
      ownerKey,
      path,
      pauseGeneration: owner.pauseGeneration,
      rootKey: owner.rootKey,
      sessionId: owner.sessionId,
      sourceBytes: 0,
    });
  }

  #invalidate(
    key: string,
    existing: Admission,
    owner: DebugInspectionOwner,
    ownerKey: string,
    path: string,
  ): void {
    this.#delete(key, existing);
    this.#insertInvalid(key, owner, ownerKey, path);
  }

  #delete(key: string, entry: Admission): void {
    this.#entries.delete(key);
    this.#sourceBytes -= entry.sourceBytes;
  }
}

export const debugInlineSourceAdmissionCoordinator = new DebugInlineSourceAdmissionCoordinator();

function admissionOwnerKey(owner: DebugInspectionOwner): string {
  return JSON.stringify([owner.rootKey, owner.sessionId, owner.pauseGeneration, owner.frameId]);
}
