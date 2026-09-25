export function agentStopConfirmationText(liveTaskCount: number): string {
  if (liveTaskCount <= 0) {
    return "Background work is still running. Press Stop or Esc again to end it.";
  }
  if (liveTaskCount === 1) {
    return "1 background task is still running. Press Stop or Esc again to end it.";
  }
  return `${liveTaskCount} background tasks are still running. Press Stop or Esc again to end them.`;
}
