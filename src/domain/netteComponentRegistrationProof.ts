import { netteAddComponentRegistrations } from "./netteComponents";
import { maskPhpSource } from "./phpSourceMask";

/**
 * True only when every local `$this->addComponent(...)` call was parsed as a
 * static literal registration. Dynamic/named/unmodelled calls make absence of
 * an arbitrary component name unknowable.
 */
export function canProveNoUnresolvedNetteAddComponentCalls(source: string): boolean {
  const registrations = new Set(
    netteAddComponentRegistrations(source).map((registration) => registration.offset),
  );
  const masked = maskPhpSource(source);
  const callPattern = /\$this\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of masked.matchAll(callPattern)) {
    const methodName = match[1];

    if (methodName?.toLowerCase() !== "addcomponent") {
      continue;
    }

    const methodOffset = (match.index ?? 0) + match[0].lastIndexOf(methodName);

    if (!registrations.has(methodOffset)) {
      return false;
    }
  }

  return true;
}
