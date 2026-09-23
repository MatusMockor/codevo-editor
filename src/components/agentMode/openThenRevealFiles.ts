export async function openThenRevealFiles(
  open: () => Promise<boolean>,
  reveal: () => void,
): Promise<boolean> {
  const opened = await open();
  if (!opened) return false;
  reveal();
  return true;
}
