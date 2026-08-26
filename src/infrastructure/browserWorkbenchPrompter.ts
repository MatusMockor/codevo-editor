import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import type { WorkbenchPrompter } from "../application/workbenchPrompter";
import type { QuickInputCoordinator } from "../application/quickInputCoordinator";

export class BrowserWorkbenchPrompter implements WorkbenchPrompter {
  constructor(private readonly quickInput: QuickInputCoordinator) {}

  async confirm(message: string): Promise<boolean> {
    try {
      return await confirmDialog(message);
    } catch {
      return false;
    }
  }

  prompt(message: string, defaultValue = ""): Promise<string | null> {
    return this.quickInput.prompt(message, defaultValue);
  }
}
