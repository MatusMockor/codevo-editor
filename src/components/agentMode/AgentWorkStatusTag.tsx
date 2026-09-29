import { CircleX } from "lucide-react";

export function AgentWorkStatusTag({ text }: { readonly text: string | null }) {
  if (text === null) return null;
  return (
    <span className="cv-work-status cv-work-status--failed">
      <span className="agent-visually-hidden">, </span>
      <CircleX aria-hidden="true" className="cv-work-status__icon" size={12} strokeWidth={2} />
      <span className="cv-work-status__text">{text}</span>
      <span className="agent-visually-hidden">, </span>
    </span>
  );
}
