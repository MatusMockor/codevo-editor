/**
 * The Monaco icon bucket a NEON completion maps to: a `services:` class name, a
 * `%param%` parameter reference, an `@service` reference, or a setup method.
 */
export type NeonCompletionItemKind =
  | "class"
  | "method"
  | "parameter"
  | "service";

/**
 * A NEON completion the application layer hands to the Monaco "neon" provider.
 * Structurally compatible with the component-layer completion shape, while
 * keeping framework intelligence independent from React/Monaco modules.
 */
export interface NeonCompletionItem {
  detail?: string;
  insertText: string;
  kind: NeonCompletionItemKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}
