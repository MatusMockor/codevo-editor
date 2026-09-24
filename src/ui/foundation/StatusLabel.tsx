import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./status.css";

export type StatusKind = "work" | "warn" | "ok" | "fail";

export interface StatusLabelProps {
  readonly kind: StatusKind;
  readonly spinner?: boolean;
  readonly children: ReactNode;
}

export function StatusLabel({ children, kind, spinner = false }: StatusLabelProps) {
  return (
    <span className={`cv-status cv-status--${kind}`}>
      {spinner ? <Spinner /> : null}
      {children}
    </span>
  );
}
