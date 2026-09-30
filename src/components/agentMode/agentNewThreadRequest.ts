export function shouldCreateNewThreadInCurrentProject(
  shiftKey: boolean,
  projectCount: number,
): boolean {
  return shiftKey || projectCount <= 1;
}

export function agentNewThreadTooltip(
  base: string,
  projectCount: number,
  currentProjectLabel: string | null,
): string {
  if (projectCount <= 1 || currentProjectLabel === null) return base;
  return `${base}\nShift-click: new thread in ${currentProjectLabel}`;
}
