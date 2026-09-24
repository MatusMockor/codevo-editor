import {
  FileDiff,
  Files,
  GitBranch,
  GitPullRequest,
  History,
  Play,
  SquareTerminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";

export interface AgentRightPanelSurfaceDescriptor {
  readonly label: string;
  readonly tabLabel: string;
  readonly icon: LucideIcon;
  readonly addMenuShortcut: string | null;
  readonly description: string;
}

export const AGENT_RIGHT_PANEL_SURFACE_CATALOG: Readonly<
  Record<AgentSurfaceKind, AgentRightPanelSurfaceDescriptor>
> = Object.freeze({
  terminal: {
    label: "Terminal",
    tabLabel: "Terminal",
    icon: SquareTerminal,
    addMenuShortcut: "T",
    description: "Start a shell in the thread's checkout.",
  },
  files: {
    label: "Files",
    tabLabel: "Files",
    icon: Files,
    addMenuShortcut: "F",
    description: "Browse and edit the thread's checkout.",
  },
  diff: {
    label: "Diff",
    tabLabel: "Diff",
    icon: FileDiff,
    addMenuShortcut: "D",
    description: "Review changes in this thread.",
  },
  git: {
    label: "Git",
    tabLabel: "Git",
    icon: GitBranch,
    addMenuShortcut: "G",
    description: "Commit, push and switch branches.",
  },
  scripts: {
    label: "Scripts",
    tabLabel: "Scripts",
    icon: Play,
    addMenuShortcut: "S",
    description: "Run package scripts and project actions.",
  },
  pullRequest: {
    label: "Pull request",
    tabLabel: "New pull request",
    icon: GitPullRequest,
    addMenuShortcut: "P",
    description: "Open a pull request for this branch.",
  },
  history: {
    label: "History",
    tabLabel: "History",
    icon: History,
    addMenuShortcut: "H",
    description: "Browse commits and file changes across your repositories.",
  },
  agents: {
    label: "Agents",
    tabLabel: "Agents",
    icon: Users,
    addMenuShortcut: null,
    description: "Subagents working in this thread.",
  },
});

export const AGENT_RIGHT_PANEL_ADD_MENU_ORDER: ReadonlyArray<AgentSurfaceKind> = Object.freeze([
  "terminal",
  "files",
  "diff",
  "git",
  "scripts",
  "pullRequest",
  "history",
]);
