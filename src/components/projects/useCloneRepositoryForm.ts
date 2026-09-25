import { useMemo, useState } from "react";
import { useCloneDestinationProbe } from "../../application/useCloneDestinationProbe";
import { abbreviateHomePath, joinClonePath } from "../../domain/cloneDestination";
import { evaluateCloneForm, type CloneFormState } from "../../domain/cloneForm";
import type { DirectoryListingGateway } from "../../domain/directoryListing";

export interface CloneRepositoryFormModel {
  readonly url: string;
  readonly branch: string;
  readonly state: CloneFormState;
  setUrl(value: string): void;
  touchUrl(): void;
  setDestination(value: string): void;
  setBranch(value: string): void;
  chooseParent(parentPath: string): void;
}

export interface CloneRepositoryFormInput {
  readonly initialUrl: string;
  readonly home: string | null;
  readonly shorthandHost: string | null;
  readonly lastParent: string | null;
  readonly directoryGateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null;
  readonly projectRootPaths: readonly string[];
}

const FALLBACK_NAME = "repository";

export function useCloneRepositoryForm(input: CloneRepositoryFormInput): CloneRepositoryFormModel {
  const [url, setUrl] = useState(input.initialUrl);
  const [urlTouched, setUrlTouched] = useState(input.initialUrl.trim() !== "");
  const [destination, setDestinationValue] = useState("");
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const formInput = { url, destination, destinationEdited, branch, urlTouched };
  const baseContext = {
    home: input.home,
    shorthandHost: input.shorthandHost,
    lastParent: input.lastParent,
  };
  const draft = evaluateCloneForm(formInput, { ...baseContext, probe: { kind: "unknown" } });
  const targetParent = draft.destinationTarget?.parentPath ?? null;
  const targetName = draft.destinationTarget?.name ?? null;
  const target = useMemo(
    () =>
      targetParent === null || targetName === null
        ? null
        : { parentPath: targetParent, name: targetName },
    [targetParent, targetName],
  );
  const probe = useCloneDestinationProbe(input.directoryGateway, target, input.projectRootPaths);
  const state = evaluateCloneForm(formInput, { ...baseContext, probe });
  return {
    url,
    branch,
    state,
    setUrl,
    touchUrl: () => setUrlTouched(true),
    setDestination(value: string) {
      setDestinationValue(value);
      setDestinationEdited(value.trim() !== "");
    },
    setBranch,
    chooseParent(parentPath: string) {
      const name = state.destinationTarget?.name ?? FALLBACK_NAME;
      setDestinationValue(abbreviateHomePath(joinClonePath(parentPath, name), input.home));
      setDestinationEdited(true);
    },
  };
}
