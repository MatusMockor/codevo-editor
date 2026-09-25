import { useId, type ReactNode } from "react";

export interface SettingsSectionHeadingProps {
  readonly actions?: ReactNode;
  readonly bare?: boolean;
  readonly children: ReactNode;
  readonly title: string;
}

export function SettingsSectionHeading({
  actions,
  bare = false,
  children,
  title,
}: SettingsSectionHeadingProps) {
  const headingId = `${useId()}-heading`;

  return (
    <section aria-labelledby={headingId} className="settings-section">
      <header className="settings-section__head">
        <h2 className="settings-section__title" id={headingId}>
          {title}
        </h2>
        {actions === undefined ? null : <div className="settings-section__actions">{actions}</div>}
      </header>
      {bare ? children : <div className="settings-group">{children}</div>}
    </section>
  );
}
