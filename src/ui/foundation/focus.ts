const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface TabKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

export function trapTabKey(event: TabKeyEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = focusableWithin(root);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    root.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function refocusWhenLost(root: HTMLElement, lost: EventTarget | null): void {
  queueMicrotask(() => {
    if (!root.isConnected) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    refocusTarget(root, lost).focus();
  });
}

function refocusTarget(root: HTMLElement, lost: EventTarget | null): HTMLElement {
  if (lost instanceof HTMLElement && lost.isConnected && root.contains(lost)) return lost;
  return root;
}
