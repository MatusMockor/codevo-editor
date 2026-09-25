export interface TerminalCommandDecoration {
  backgroundColor: string;
  foregroundColor?: string;
  tooltip: string;
}

export function terminalCommandDecoration(exitCode: number): TerminalCommandDecoration {
  if (exitCode === 0) {
    return {
      backgroundColor: "var(--cv-ok)",
      tooltip: "Exit code 0",
    };
  }

  return {
    backgroundColor: "var(--cv-danger)",
    tooltip: `Exit code ${exitCode}`,
  };
}
