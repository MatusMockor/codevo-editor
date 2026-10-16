import { memo, type ComponentProps } from "react";
import { AgentThreadHeader } from "../AgentThreadHeader";

export type AgentModeHeaderProps = ComponentProps<typeof AgentThreadHeader>;

export const AgentModeHeader = memo(function AgentModeHeader(props: AgentModeHeaderProps) {
  return <AgentThreadHeader {...props} />;
});
