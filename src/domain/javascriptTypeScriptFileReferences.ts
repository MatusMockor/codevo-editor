import {
  pathFromLanguageServerUri,
  type LanguageServerCodeActionCommand,
  type LanguageServerLocationList,
} from "./languageServerFeatures";
import { fileUriFromPath } from "./languageServerDocumentSync";

const FIND_ALL_FILE_REFERENCES_COMMAND = "_typescript.findAllFileReferences";

export function findAllFileReferencesCommand(path: string): LanguageServerCodeActionCommand {
  return {
    arguments: [fileUriFromPath(path)],
    command: FIND_ALL_FILE_REFERENCES_COMMAND,
    title: "Find File References",
  };
}

export function filterFileReferenceLocationsToWorkspace(
  locations: LanguageServerLocationList,
  workspaceRoot: string,
): LanguageServerLocationList {
  const rootPrefix = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;

  const filtered = locations.filter((location) => {
    const path = pathFromLanguageServerUri(location.uri);

    return Boolean(path && (path === workspaceRoot || path.startsWith(rootPrefix)));
  });
  Object.defineProperties(filtered, {
    isIncomplete: {
      configurable: true,
      value: locations.isIncomplete === true || filtered.length !== locations.length,
    },
    totalCount: {
      configurable: true,
      value: locations.totalCount ?? locations.length,
    },
  });
  return filtered;
}
