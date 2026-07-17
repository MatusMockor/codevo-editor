import type { EditorPosition } from "./languageServerFeatures";

export type TestFilterMatch = "identifier" | "description";

export type TestGutterTargetKind = "class" | "method";

export interface TestGutterTarget {
  filter: string;
  kind: TestGutterTargetKind;
  label: string;
  match: TestFilterMatch;
  position: EditorPosition;
}
