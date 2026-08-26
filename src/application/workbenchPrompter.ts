export interface WorkbenchPrompter {
  confirm(message: string): Promise<boolean> | boolean;
  prompt(message: string, defaultValue?: string): Promise<string | null> | string | null;
}

export async function confirmWorkbenchAction(
  prompter: Pick<WorkbenchPrompter, "confirm">,
  message: string,
): Promise<boolean> {
  try {
    return (await prompter.confirm(message)) === true;
  } catch {
    return false;
  }
}
