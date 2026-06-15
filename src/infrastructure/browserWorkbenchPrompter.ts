import type { WorkbenchPrompter } from "../application/workbenchPrompter";

export class BrowserWorkbenchPrompter implements WorkbenchPrompter {
  confirm(message: string): boolean {
    return window.confirm(message);
  }

  prompt(message: string, defaultValue = ""): string | null {
    return window.prompt(message, defaultValue);
  }
}
