export function secureJsTestTaskRunId(): string {
  const runId = globalThis.crypto?.randomUUID?.();
  if (!runId) throw new Error("Secure JavaScript test task IDs are unavailable.");
  return runId;
}
