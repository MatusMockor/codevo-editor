import type * as Monaco from "monaco-editor";

const identities = new WeakMap<Monaco.editor.ITextModel, string>();
let nextIdentity = 1n;

/** Stable process-local identity that distinguishes model replacement at the same URI. */
export function monacoModelIdentity(model: Monaco.editor.ITextModel): string {
  const existing = identities.get(model);
  if (existing) return existing;
  const sequence = nextIdentity;
  nextIdentity += 1n;
  const identity = JSON.stringify([sequence.toString(), model.uri.toString()]);
  identities.set(model, identity);
  return identity;
}
