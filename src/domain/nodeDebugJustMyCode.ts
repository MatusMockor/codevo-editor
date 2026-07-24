/** Closed internal policy; raw VS Code glob patterns never cross the import boundary. */
export type NodeDebugJustMyCodePolicy =
  "dependencies" | "nodeInternals" | "nodeInternalsAndDependencies";

export function isNodeDebugJustMyCodePolicy(value: unknown): value is NodeDebugJustMyCodePolicy {
  return (
    value === "dependencies" ||
    value === "nodeInternals" ||
    value === "nodeInternalsAndDependencies"
  );
}
