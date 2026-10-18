import { useEffect, useRef, type KeyboardEvent } from "react";
import { SettingsButton } from "../primitives/SettingsButton";

export interface EnvironmentServerRemoveConfirmProps {
  readonly name: string;
  readonly disabled: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function EnvironmentServerRemoveConfirm({
  name,
  disabled,
  onCancel,
  onConfirm,
}: EnvironmentServerRemoveConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      aria-label={`Remove ${name}?`}
      className="settings-environments__confirm"
      onKeyDown={handleKeyDown}
      role="group"
    >
      <p className="settings-environments__confirm-text">
        <strong>Remove {name}?</strong> Threads stay on the server; you can add it again later.
      </p>
      <SettingsButton onClick={onCancel} ref={cancelRef} variant="outline">
        Cancel
      </SettingsButton>
      <SettingsButton disabled={disabled} onClick={onConfirm} variant="danger">
        Remove
      </SettingsButton>
    </div>
  );
}
