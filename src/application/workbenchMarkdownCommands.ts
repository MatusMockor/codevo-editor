import type { Command } from "./commandRegistry";

interface WorkbenchMarkdownCommandsOptions {
  isActiveDocumentMarkdown: boolean;
  openMarkdownPreview(): void | Promise<void>;
}

export function workbenchMarkdownCommands({
  isActiveDocumentMarkdown,
  openMarkdownPreview,
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
      shortcut: "Cmd+Shift+V",
      title: "Markdown: Open Preview",
    },
  ];
}
