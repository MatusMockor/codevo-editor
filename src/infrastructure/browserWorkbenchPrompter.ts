import type { WorkbenchPrompter } from "../application/workbenchPrompter";

export class BrowserWorkbenchPrompter implements WorkbenchPrompter {
  confirm(message: string): boolean {
    try {
      return window.confirm(message);
    } catch {
      return false;
    }
  }

  prompt(message: string, defaultValue = ""): string | null {
    try {
      return window.prompt(message, defaultValue);
    } catch {
      return null;
    }
  }
}
