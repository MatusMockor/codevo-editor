import { useRef, type ReactNode } from "react";

interface DeferredSurfaceHostProps {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}

export function DeferredSurfaceHost({ active, children, fallback }: DeferredSurfaceHostProps) {
  const activatedRef = useRef(active);
  if (active) {
    activatedRef.current = true;
  }

  if (!activatedRef.current) {
    return active ? fallback : null;
  }

  return children;
}
