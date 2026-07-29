import type * as Monaco from "monaco-editor";
import type {
  LanguageServerDocumentSymbol,
  LanguageServerWorkspaceSymbol,
} from "../../domain/languageServerFeatures";
import { toJavaScriptTypeScriptMonacoLocations } from "../javascriptTypescriptMonacoNavigationLocations";
import { toMonacoRange } from "./sharedMappings";

export interface JavaScriptTypeScriptMonacoWorkspaceSymbol {
  containerName?: string;
  kind: Monaco.languages.SymbolKind;
  location: Monaco.languages.Location;
  name: string;
}

export function toMonacoDocumentSymbol(
  monaco: typeof Monaco,
  symbol: LanguageServerDocumentSymbol,
): Monaco.languages.DocumentSymbol {
  return {
    children: symbol.children.map((child) => toMonacoDocumentSymbol(monaco, child)),
    ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
    detail: symbol.detail ?? "",
    kind: monacoSymbolKindFromLspKind(monaco, symbol.kind),
    name: symbol.name,
    range: toMonacoRange(monaco, symbol.range),
    selectionRange: toMonacoRange(monaco, symbol.selectionRange),
    tags: (symbol.tags ?? [])
      .map((tag) => (tag === 1 ? monaco.languages.SymbolTag.Deprecated : undefined))
      .filter((tag): tag is Monaco.languages.SymbolTag => tag !== undefined),
  };
}

export function toMonacoWorkspaceSymbol(
  monaco: typeof Monaco,
  symbol: LanguageServerWorkspaceSymbol,
  rootPath: string,
): JavaScriptTypeScriptMonacoWorkspaceSymbol[] {
  if (!symbol.location) {
    return [];
  }
  const [location] = toJavaScriptTypeScriptMonacoLocations(monaco, [symbol.location], rootPath);
  return location
    ? [
        {
          ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
          kind: monacoSymbolKindFromLspKind(monaco, symbol.kind),
          location,
          name: symbol.name,
        },
      ]
    : [];
}

function monacoSymbolKindFromLspKind(
  monaco: typeof Monaco,
  kind: number,
): Monaco.languages.SymbolKind {
  const kinds = monaco.languages.SymbolKind;
  switch (kind) {
    case 1:
      return kinds.File;
    case 2:
      return kinds.Module;
    case 3:
      return kinds.Namespace;
    case 4:
      return kinds.Package;
    case 5:
      return kinds.Class;
    case 6:
      return kinds.Method;
    case 7:
      return kinds.Property;
    case 8:
      return kinds.Field;
    case 9:
      return kinds.Constructor;
    case 10:
      return kinds.Enum;
    case 11:
      return kinds.Interface;
    case 12:
      return kinds.Function;
    case 13:
      return kinds.Variable;
    case 14:
      return kinds.Constant;
    case 15:
      return kinds.String;
    case 16:
      return kinds.Number;
    case 17:
      return kinds.Boolean;
    case 18:
      return kinds.Array;
    case 19:
      return kinds.Object;
    case 20:
      return kinds.Key;
    case 21:
      return kinds.Null;
    case 22:
      return kinds.EnumMember;
    case 23:
      return kinds.Struct;
    case 24:
      return kinds.Event;
    case 25:
      return kinds.Operator;
    case 26:
      return kinds.TypeParameter;
    default:
      return kinds.Variable;
  }
}
