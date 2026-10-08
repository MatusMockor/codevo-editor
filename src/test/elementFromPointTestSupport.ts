const HIT_TEST_EXCLUDED = "[inert], [hidden]";

export function installElementFromPoint(target: Document = document): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, "elementFromPoint");
  Object.defineProperty(target, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) => topmostElementAt(target, x, y),
  });
  return () => {
    Reflect.deleteProperty(target, "elementFromPoint");
    if (previous !== undefined) Object.defineProperty(target, "elementFromPoint", previous);
  };
}

function topmostElementAt(target: Document, x: number, y: number): Element | null {
  const painted = [...target.querySelectorAll("*")].reverse();
  return painted.find((element) => isHitAt(element, x, y)) ?? null;
}

function isHitAt(element: Element, x: number, y: number): boolean {
  if (element.closest(HIT_TEST_EXCLUDED) !== null) return false;
  const bounds = element.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;
  if (x < bounds.left || x > bounds.right) return false;
  return y >= bounds.top && y <= bounds.bottom;
}
