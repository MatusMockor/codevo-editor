import { agentProjectBadgeMonogram, agentProjectBadgeTone } from "./agentProjectMonogram";

export function AgentProjectBadge({ label }: { readonly label: string }) {
  return (
    <span aria-hidden="true" className="cv-project-badge" data-tone={agentProjectBadgeTone(label)}>
      {agentProjectBadgeMonogram(label)}
    </span>
  );
}
