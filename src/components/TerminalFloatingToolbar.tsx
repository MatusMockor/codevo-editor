import { Columns2, Plus, RotateCcw, Square } from "lucide-react";
import "./terminalFloatingToolbar.css";

export interface TerminalFloatingToolbarProps {
  readonly canStop: boolean;
  readonly canRestart: boolean;
  readonly split: boolean;
  readonly canCreate: boolean;
  onStop(): void;
  onRestart(): void;
  onToggleSplit(): void;
  onCreate(): void;
}

export function TerminalFloatingToolbar(props: TerminalFloatingToolbarProps) {
  return (
    <div aria-label="Terminal actions" className="cv-term-toolbar" role="toolbar">
      <button
        aria-label="Stop terminal"
        disabled={!props.canStop}
        onClick={props.onStop}
        title="Stop"
        type="button"
      >
        <Square aria-hidden="true" size={12} />
        Stop
      </button>
      <button
        aria-label="Restart terminal"
        disabled={!props.canRestart}
        onClick={props.onRestart}
        title="Restart"
        type="button"
      >
        <RotateCcw aria-hidden="true" size={12} />
      </button>
      <span aria-hidden="true" className="cv-term-toolbar__sep" />
      <button
        aria-label="Split terminal"
        aria-pressed={props.split}
        disabled={!props.split && !props.canCreate}
        onClick={props.onToggleSplit}
        title="Split"
        type="button"
      >
        <Columns2 aria-hidden="true" size={12} />
      </button>
      <span aria-hidden="true" className="cv-term-toolbar__sep" />
      <button
        aria-label="New terminal"
        disabled={!props.canCreate}
        onClick={props.onCreate}
        title="New terminal"
        type="button"
      >
        <Plus aria-hidden="true" size={12} />
      </button>
    </div>
  );
}
