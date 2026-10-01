import { agentJumpSlots } from "./agentSidebarPresentation";

export function rovingThreadId(
  request: string | null,
  selected: string | null,
  visible: ReadonlyArray<string>,
): string | null {
  if (request !== null && visible.includes(request)) return request;
  if (selected !== null && visible.includes(selected)) return selected;
  return visible[0] ?? null;
}

export function nextThreadIndex(key: string, index: number, length: number): number | null {
  if (key === "ArrowDown") return Math.min(index + 1, length - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

export function jumpLabelsFor(
  order: ReadonlyArray<string>,
  glyph: string,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const [threadId, slot] of agentJumpSlots(order)) labels.set(threadId, `${glyph}${slot}`);
  return labels;
}

export function isThreadRow(target: EventTarget, threadId: string): boolean {
  return target instanceof HTMLElement && target.dataset.threadId === threadId;
}

export function focusRow(list: HTMLDivElement | null, threadId: string): void {
  const rows = list?.querySelectorAll<HTMLElement>("[data-thread-id]");
  for (const row of Array.from(rows ?? [])) {
    if (row.dataset.threadId !== threadId) continue;
    row.focus();
    return;
  }
}
