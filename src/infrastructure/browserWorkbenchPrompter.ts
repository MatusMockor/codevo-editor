import type { WorkbenchPrompter } from "../application/workbenchPrompter";
import type { QuickInputCoordinator } from "../application/quickInputCoordinator";

export class BrowserWorkbenchPrompter implements WorkbenchPrompter {
  constructor(private readonly quickInput: QuickInputCoordinator) {}

  confirm(message: string): boolean {
    try {
      return window.confirm(message);
    } catch {
      return false;
    }
  }

  prompt(message: string, defaultValue = ""): Promise<string | null> {
    return this.quickInput.prompt(message, defaultValue);
  }
}
