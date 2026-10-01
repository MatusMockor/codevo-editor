export function agentProjectMonogram(label: string): string {
  const first = [...label].find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? "?" : first.toLocaleUpperCase();
}
