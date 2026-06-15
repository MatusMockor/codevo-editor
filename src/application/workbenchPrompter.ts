export interface WorkbenchPrompter {
  confirm(message: string): boolean;
  prompt(message: string, defaultValue?: string): string | null;
}
