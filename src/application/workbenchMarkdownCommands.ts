import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchMarkdownCommandsOptions {
  isActiveDocumentMarkdown: boolean;
  openMarkdownPreview(): void | Promise<void>;
  shortcut(commandId: KeymapCommandId): string;
}

export function workbenchMarkdownCommands({
  isActiveDocumentMarkdown,
  openMarkdownPreview,
  shortcut,
}: WorkbenchMarkdownCommandsOptions): Command[] {
  return [
    {
      category: "Markdown",
      id: "markdown.openPreview",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentMarkdown,
      run: openMarkdownPreview,
      shortcut: shortcut("markdown.openPreview"),
      title: "Markdown: Open Preview",
    },
  ];
}
