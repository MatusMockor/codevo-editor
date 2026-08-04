import type { JavaScriptTypeScriptFeatureRequestIntent } from "./requestBoundary";

export type JavaScriptTypeScriptInteractiveFeature =
  | "completion"
  | "declaration"
  | "definition"
  | "documentHighlight"
  | "hover"
  | "implementation"
  | "linkedEditingRange"
  | "prepareRename"
  | "references"
  | "rename"
  | "signatureHelp"
  | "typeDefinition";

/** Explicitly requested features that remain bounded for policy-large JS/TS documents. */
export function javaScriptTypeScriptFeatureAllowsExplicitInteractiveAccess(
  feature: JavaScriptTypeScriptInteractiveFeature,
  intent: JavaScriptTypeScriptFeatureRequestIntent,
): boolean {
  switch (feature) {
    case "completion":
      return intent === "explicit";
    case "definition":
    case "prepareRename":
    case "references":
    case "rename":
      return true;
    case "declaration":
    case "documentHighlight":
    case "hover":
    case "implementation":
    case "linkedEditingRange":
    case "signatureHelp":
    case "typeDefinition":
      return false;
  }
}
