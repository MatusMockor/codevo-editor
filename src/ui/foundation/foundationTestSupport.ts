import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export interface MountedUi {
  readonly host: HTMLElement;
  render(node: ReactNode): void;
  unmount(): void;
}

export function mountUi(): MountedUi {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    render(node) {
      act(() => root.render(node));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }),
    );
  });
}

export function click(target: Element): void {
  act(() => {
    (target as HTMLElement).click();
  });
}

export function pointer(target: Element, type: string, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
    );
  });
}
