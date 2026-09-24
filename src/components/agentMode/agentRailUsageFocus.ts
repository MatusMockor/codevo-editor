export function focusUsageSuccessor(trigger: HTMLButtonElement | null): void {
  if (isConnectedVisibleButton(trigger)) {
    trigger.focus();
    return;
  }
  const expand = document.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]');
  if (isConnectedVisibleButton(expand)) expand.focus();
}

function isConnectedVisibleButton(button: HTMLButtonElement | null): button is HTMLButtonElement {
  if (button === null || !button.isConnected || button.disabled || button.hidden) return false;
  if (button.closest('[hidden], [aria-hidden="true"]') !== null) return false;
  const style = getComputedStyle(button);
  return style.display !== "none" && style.visibility !== "hidden";
}
