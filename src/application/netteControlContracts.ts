import type { EditorPosition } from "../domain/languageServerFeatures";

export interface NetteControlDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  openPhpMethodTarget(className: string, methodName: string): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  readPhpClassSource?(
    className: string,
  ): Promise<{ path: string; source: string } | null>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
}

export interface NetteControlCompletionItem {
  detail?: string;
  insertText: string;
  kind: "component";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NetteControlCacheEntry {
  componentNames: string[];
  expiresAt: number;
  templateRelativePath: string;
}

export type NetteControlCache = Record<string, NetteControlCacheEntry>;

export interface NetteControlCompletionContext {
  componentCache: NetteControlCache;
  deps: NetteControlDependencies;
  isRequestedRootActive(): boolean;
  maxCompletions: number;
  requestedRoot: string;
  templateRelativePath: string;
  ttlMs: number;
}
