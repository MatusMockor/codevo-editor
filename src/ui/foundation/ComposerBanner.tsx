import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./status.css";

export type ComposerBannerTone = "neutral" | "working" | "warn";

export interface ComposerBannerProps {
  readonly tone?: ComposerBannerTone;
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly announce?: boolean;
}

export function ComposerBanner({
  actions,
  announce = true,
  children,
  icon,
  tone = "neutral",
}: ComposerBannerProps) {
  return (
    <div
      aria-live={announce ? "polite" : undefined}
      className={`cv-composer-banner cv-composer-banner--${tone}`}
      role={announce ? "status" : undefined}
    >
      {leadingVisual(tone, icon)}
      <span className="cv-composer-banner__message">{children}</span>
      {actions === undefined ? null : (
        <span className="cv-composer-banner__actions">{actions}</span>
      )}
    </div>
  );
}

function leadingVisual(tone: ComposerBannerTone, icon: ReactNode): ReactNode {
  if (tone === "working") return <Spinner />;
  if (icon === undefined) return null;
  return (
    <span aria-hidden="true" className="cv-composer-banner__icon">
      {icon}
    </span>
  );
}
