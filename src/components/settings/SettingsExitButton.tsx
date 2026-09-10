import { ArrowLeft } from "lucide-react";

export interface SettingsExitButtonProps {
  onExit(): void;
}

export function SettingsExitButton({ onExit }: SettingsExitButtonProps) {
  return (
    <button className="settings-back" onClick={onExit} type="button">
      <ArrowLeft aria-hidden="true" size={14} />
      Back
    </button>
  );
}
