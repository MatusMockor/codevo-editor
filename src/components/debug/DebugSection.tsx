import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

export interface DebugSectionProps {
  readonly title: string;
  readonly count?: string | number;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function DebugSection({ actions, children, count, title }: DebugSectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={title} className="cv-dside__sec">
      <div className="cv-dside__bar">
        <button
          aria-expanded={open}
          className="cv-dside__head"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="cv-dside__chev" size={12} />
          <span>{title}</span>
          {count === undefined ? null : <span className="cv-dside__count">{count}</span>}
        </button>
        {actions === undefined ? null : <span className="cv-dside__actions">{actions}</span>}
      </div>
      {open ? <div className="cv-dside__body">{children}</div> : null}
    </section>
  );
}
