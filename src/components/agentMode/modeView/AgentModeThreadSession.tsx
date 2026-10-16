import { memo } from "react";
import { AgentThreadSession, type AgentThreadSessionProps } from "../AgentThreadSession";

export const AgentModeThreadSession = memo(function AgentModeThreadSession(
  props: AgentThreadSessionProps,
) {
  return <AgentThreadSession {...props} />;
});
