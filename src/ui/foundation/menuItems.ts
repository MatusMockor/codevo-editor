import { rovingIndex } from "./roving";

export function menuItems(surface: HTMLElement, menuId: string): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(`[data-cv-menu="${menuId}"]`)].filter(
    (item) => item.getAttribute("aria-disabled") !== "true",
  );
}

export function focusMenuItem(surface: HTMLElement, menuId: string, key: string): boolean {
  const items = menuItems(surface, menuId);
  const current = items.findIndex((item) => item === document.activeElement);
  const next = rovingIndex(key, current, items.length, "vertical");
  if (next === null) return false;
  items[next]?.focus();
  return true;
}
