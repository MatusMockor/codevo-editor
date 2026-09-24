export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

export function fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined {
  if (hint === undefined && error === undefined) return undefined;
  return fieldHintId(id);
}
