/** LSP CodeActionKind matching is hierarchical: `refactor` includes `refactor.extract`. */
export function languageServerCodeActionKindMatchesOnly(
  kind: string | null,
  only: string | undefined,
): boolean {
  if (!only) return true;
  return kind === only || Boolean(kind?.startsWith(`${only}.`));
}

export function languageServerCodeActionsMatchingOnly<T extends { readonly kind: string | null }>(
  actions: readonly T[],
  only: string | undefined,
): T[] {
  return actions.filter(({ kind }) => languageServerCodeActionKindMatchesOnly(kind, only));
}
