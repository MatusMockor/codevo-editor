import { Users } from "lucide-react";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useAgentAgentsPanelControls } from "./agentAgentsPanelHooks";

export function AgentAgentsToggleButton() {
  const controls = useAgentAgentsPanelControls();
  return (
    <IconButton
      icon={<Users size={16} />}
      label="Toggle agents panel"
      onClick={controls.toggle}
      pressed={controls.isOpen}
      title={controls.working > 0 ? `Agents · ${controls.working} working` : "Agents"}
    />
  );
}
