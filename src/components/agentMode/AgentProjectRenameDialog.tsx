import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  parseProjectDisplayName,
  projectDisplayNameRejectionMessage,
} from "../../domain/projectDisplayName";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";
import { TextField } from "../../ui/foundation/TextField";
import {
  agentProjectRenameConflict,
  type AgentProjectRenameTarget,
} from "./agentProjectDisplayNames";
import type { AgentProjectRenameOutcome } from "./useAgentProjectRename";

const MAX_PROJECT_NAME_INPUT_CHARS = 4096;

export interface AgentProjectRenameDialogProps {
  readonly target: AgentProjectRenameTarget | null;
  onCancel(): void;
  onSubmit(input: string): AgentProjectRenameOutcome;
}

export function AgentProjectRenameDialog({
  onCancel,
  onSubmit,
  target,
}: AgentProjectRenameDialogProps) {
  if (target === null) return null;
  return (
    <ProjectRenameForm
      key={target.requestedRootKey}
      onCancel={onCancel}
      onSubmit={onSubmit}
      target={target}
    />
  );
}

interface ProjectRenameFormProps {
  readonly target: AgentProjectRenameTarget;
  onCancel(): void;
  onSubmit(input: string): AgentProjectRenameOutcome;
}

function ProjectRenameForm({ onCancel, onSubmit, target }: ProjectRenameFormProps) {
  const [value, setValue] = useState(target.displayName ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusSeen = useRef(false);
  const parsed = parseProjectDisplayName(value);
  const invalid =
    parsed.kind === "invalid" ? projectDisplayNameRejectionMessage(parsed.reason) : null;
  const conflict = parsed.kind === "name" ? agentProjectRenameConflict(target, parsed.name) : null;

  const submit = (input: string): void => {
    const outcome = onSubmit(input);
    if (outcome.kind === "rejected") setFailure(outcome.message);
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>): void => {
    if (focusSeen.current) return;
    focusSeen.current = true;
    event.currentTarget.select();
    if (event.relatedTarget instanceof HTMLElement) returnFocusRef.current = event.relatedTarget;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (invalid !== null) return;
    submit(value);
  };

  return (
    <Dialog
      description={projectRenameDescription(
        target.memberRootKeys.length + target.offlineRootKeys.length,
        target.offlineRootKeys.length,
      )}
      footer={
        <>
          {target.displayName !== null && (
            <Button onClick={() => submit("")} type="button" variant="ghost">
              Reset to default
            </Button>
          )}
          <Button onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            disabled={invalid !== null}
            onClick={() => submit(value)}
            type="button"
            variant="primary"
          >
            Rename
          </Button>
        </>
      }
      onClose={onCancel}
      open
      returnFocusRef={returnFocusRef}
      title="Rename project"
      width="sm"
    >
      <TextField
        autoComplete="off"
        error={invalid ?? failure ?? undefined}
        hint={conflict === null ? undefined : projectRenameConflictHint(conflict)}
        label="Project name"
        maxLength={MAX_PROJECT_NAME_INPUT_CHARS}
        onChange={(next) => {
          setValue(next);
          setFailure(null);
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={target.defaultLabel}
        spellCheck={false}
        value={value}
      />
    </Dialog>
  );
}

function projectRenameConflictHint(label: string): string {
  return `Another project is already named "${label}". You can still use this name.`;
}

function projectRenameDescription(checkouts: number, offline: number): string {
  if (offline > 0) {
    return `The name applies to ${checkouts} checkouts of this project in Codevo, including ${offline} that ${offline === 1 ? "is" : "are"} not connected right now. Folders and server projects are not renamed.`;
  }
  if (checkouts > 1) {
    return `The name applies to all ${checkouts} checkouts of this project in Codevo. Folders and server projects are not renamed.`;
  }
  return "The name is shown only in Codevo. The project folder is not renamed.";
}
