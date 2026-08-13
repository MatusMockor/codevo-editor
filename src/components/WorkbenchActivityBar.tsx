import { FolderOpen, History, ListChecks, Search, Settings as SettingsIcon } from "lucide-react";

interface WorkbenchActivityBarProps {
  readonly hasWorkspace: boolean;
  onOpenSettings(): void;
  onOpenWorkspace(): void;
  onShowCommands(): void;
  onShowGitHistory(): void;
  onShowTodoPanel(): void;
}

export function WorkbenchActivityBar({
  hasWorkspace,
  onOpenSettings,
  onOpenWorkspace,
  onShowCommands,
  onShowGitHistory,
  onShowTodoPanel,
}: WorkbenchActivityBarProps) {
  return (
    <aside className="activity-bar" aria-label="Primary navigation">
      <button onClick={onOpenWorkspace} title="Open workspace" type="button">
        <FolderOpen aria-hidden="true" size={20} />
      </button>
      <button onClick={onShowCommands} title="Commands" type="button">
        <Search aria-hidden="true" size={20} />
      </button>
      <button
        disabled={!hasWorkspace}
        onClick={onShowTodoPanel}
        title="TODO comments"
        type="button"
      >
        <ListChecks aria-hidden="true" size={20} />
      </button>
      <button disabled={!hasWorkspace} onClick={onShowGitHistory} title="Git history" type="button">
        <History aria-hidden="true" size={20} />
      </button>
      <button
        className="activity-bar-secondary"
        onClick={onOpenSettings}
        title="Settings"
        type="button"
      >
        <SettingsIcon aria-hidden="true" size={20} />
      </button>
    </aside>
  );
}
