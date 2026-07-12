export interface TerminalCommandDecoration {
  backgroundColor: string;
  foregroundColor?: string;
  tooltip: string;
}

export function terminalCommandDecoration(
  exitCode: number,
): TerminalCommandDecoration {
  if (exitCode === 0) {
    return {
      backgroundColor: "var(--color-success)",
      tooltip: "Exit code 0",
    };
  }

  return {
    backgroundColor: "var(--color-error)",
    tooltip: `Exit code ${exitCode}`,
  };
}
