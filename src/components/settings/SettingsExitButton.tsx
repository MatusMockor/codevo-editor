import { ArrowLeft } from "lucide-react";

export interface SettingsExitButtonProps {
  onExit(): void;
}

export function SettingsExitButton({ onExit }: SettingsExitButtonProps) {
  return (
    <button className="settings-nav__item" onClick={onExit} type="button">
      <ArrowLeft aria-hidden="true" size={16} />
      Back
    </button>
  );
}
