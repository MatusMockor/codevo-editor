import type { Breakpoint } from "./debug";
import { isDebugBreakpointModel, isBreakpointPathSupported } from "./debugBreakpointPolicy";
import { MAX_DEBUG_BREAKPOINT_CONDITION_BYTES, utf8ByteLength } from "./debugBreakpointPolicy";

export interface DebugBreakpointGutterCapabilities {
  readonly breakpoints: boolean;
  readonly hitConditions: boolean;
  readonly logpoints: boolean;
}

export type DebugBreakpointGutterMenuItem =
  | { readonly id: "add"; readonly label: "Add Breakpoint" }
  | {
      readonly id: "addConditional";
      readonly label: "Add Conditional Breakpoint...";
    }
  | { readonly id: "addHitCondition"; readonly label: "Add Hit Count..." }
  | { readonly id: "addLogpoint"; readonly label: "Add Logpoint..." }
  | {
      readonly id: "editConditional";
      readonly label: "Add Conditional Breakpoint..." | "Edit Conditional Breakpoint...";
    }
  | { readonly id: "editHitCondition"; readonly label: "Add Hit Count..." | "Edit Hit Count..." }
  | { readonly id: "editLogpoint"; readonly label: "Add Logpoint..." | "Edit Logpoint..." }
  | { readonly id: "removeLogpoint"; readonly label: "Remove Logpoint" }
  | { readonly id: "remove"; readonly label: "Remove Breakpoint" }
  | { readonly id: "disable"; readonly label: "Disable Breakpoint" }
  | { readonly id: "enable"; readonly label: "Enable Breakpoint" };

const NO_CAPABILITIES: DebugBreakpointGutterCapabilities = Object.freeze({
  breakpoints: false,
  hitConditions: false,
  logpoints: false,
});

export function debugBreakpointGutterCapabilities(
  workspaceRoot: string,
  filePath: string,
): DebugBreakpointGutterCapabilities {
  const node = isBreakpointPathSupported(workspaceRoot, "node", filePath);
  const php = isBreakpointPathSupported(workspaceRoot, "php", filePath);
  if (!node && !php) return NO_CAPABILITIES;
  return {
    breakpoints: true,
    hitConditions: node,
    logpoints: node,
  };
}

export function debugBreakpointGutterMenuItems(
  breakpoint: Breakpoint | null,
  capabilities: DebugBreakpointGutterCapabilities,
): readonly DebugBreakpointGutterMenuItem[] {
  if (!capabilities.breakpoints) return [];
  if (!breakpoint) {
    const items: DebugBreakpointGutterMenuItem[] = [
      { id: "add", label: "Add Breakpoint" },
      {
        id: "addConditional",
        label: "Add Conditional Breakpoint...",
      },
    ];
    if (capabilities.hitConditions) {
      items.push({ id: "addHitCondition", label: "Add Hit Count..." });
    }
    if (capabilities.logpoints) {
      items.push({ id: "addLogpoint", label: "Add Logpoint..." });
    }
    return items;
  }
  if (!isDebugBreakpointModel(breakpoint)) return [];
  const items: DebugBreakpointGutterMenuItem[] = [
    {
      id: "editConditional",
      label: breakpoint.condition
        ? "Edit Conditional Breakpoint..."
        : "Add Conditional Breakpoint...",
    },
  ];
  if (capabilities.hitConditions) {
    items.push({
      id: "editHitCondition",
      label: breakpoint.hitCondition ? "Edit Hit Count..." : "Add Hit Count...",
    });
  }
  if (capabilities.logpoints) {
    items.push({
      id: "editLogpoint",
      label: breakpoint.logMessage ? "Edit Logpoint..." : "Add Logpoint...",
    });
  }
  if (capabilities.logpoints && breakpoint.logMessage) {
    items.push({ id: "removeLogpoint", label: "Remove Logpoint" });
  }
  items.push(
    { id: "remove", label: "Remove Breakpoint" },
    breakpoint.enabled
      ? { id: "disable", label: "Disable Breakpoint" }
      : { id: "enable", label: "Enable Breakpoint" },
  );
  return items;
}

export function debugBreakpointConditionError(value: string): string | null {
  if (value.includes("\0")) return "Conditions cannot contain a NUL character.";
  if (utf8ByteLength(value) > MAX_DEBUG_BREAKPOINT_CONDITION_BYTES) {
    return `Conditions must be at most ${MAX_DEBUG_BREAKPOINT_CONDITION_BYTES} UTF-8 bytes.`;
  }
  return null;
}

export function debugBreakpointConditionValue(value: string): string | null {
  const condition = value.trim();
  return condition === "" ? null : condition;
}
