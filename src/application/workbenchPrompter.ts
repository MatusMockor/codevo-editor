export interface WorkbenchPrompter {
  confirm(message: string): boolean;
  prompt(message: string, defaultValue?: string): Promise<string | null> | string | null;
}
