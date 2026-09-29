import { ChevronDown } from "lucide-react";
import type { AgentLaunchOptions, CodexLaunchOptions } from "../../domain/agentLaunch";
import { MenuLabel } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import { agentLaunchWithEffort } from "./agentLaunchPresentation";
import { CODEX_EFFORT_TEXT, codexLaunchTraits } from "./codexLaunchPresentation";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";
import { useAgentCodexModelCatalog } from "./useAgentCodexModelCatalog";

interface AgentCodexEffortPickerProps {
  readonly launch: CodexLaunchOptions;
  readonly disabled: boolean;
  readonly configuredModel: string | null;
  readonly openRequest?: object | null;
  onOpenRequestHandled?(): void;
  onChange(next: AgentLaunchOptions): void;
}

export function AgentCodexEffortPicker({
  configuredModel,
  disabled,
  launch,
  onChange,
  onOpenRequestHandled,
  openRequest = null,
}: AgentCodexEffortPickerProps) {
  const catalog = useAgentCodexModelCatalog();
  const traits = codexLaunchTraits(launch, configuredModel, catalog);
  if (traits.efforts.length === 0) return null;
  const selected = traits.efforts.find((effort) => effort === launch.effort) ?? "default";
  const pick = (effort: string): void =>
    onChange(agentLaunchWithEffort(launch, effort, configuredModel, undefined, catalog));

  return (
    <ComposerMenuPicker
      disabled={disabled}
      label="Reasoning effort"
      onOpenRequestHandled={onOpenRequestHandled}
      openRequest={openRequest}
      renderTrigger={(trigger) => (
        <button
          aria-expanded={trigger.open}
          aria-haspopup="menu"
          aria-label="Reasoning effort"
          className="agent-picker__trigger agent-picker__trigger--ghost"
          data-value={launch.effort ?? "default"}
          disabled={disabled}
          id="agent-launch-effort"
          onClick={trigger.toggle}
          ref={trigger.ref}
          type="button"
        >
          <span className="agent-picker__value">
            {selected === "default" ? "Default" : CODEX_EFFORT_TEXT[selected].label}
          </span>
          <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
        </button>
      )}
    >
      <MenuLabel>Effort</MenuLabel>
      <MenuRadioItem
        checked={selected === "default"}
        description="Codex configuration or model default"
        onSelect={() => pick("default")}
      >
        Default
      </MenuRadioItem>
      {traits.efforts.map((effort) => (
        <MenuRadioItem
          checked={selected === effort}
          description={traits.defaultEffort === effort ? "Model default" : undefined}
          key={effort}
          onSelect={() => pick(effort)}
        >
          {CODEX_EFFORT_TEXT[effort].label}
        </MenuRadioItem>
      ))}
    </ComposerMenuPicker>
  );
}
