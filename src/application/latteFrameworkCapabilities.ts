import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
} from "../domain/phpFrameworkProviders";
import type { LatteFrameworkCapabilities } from "./latteIntelligenceContracts";

export function createLatteFrameworkCapabilities(
  getProviders: () => readonly PhpFrameworkProvider[],
): LatteFrameworkCapabilities {
  const activeLatte = () =>
    getProviders().find((provider) => provider.latte !== undefined)?.latte;

  return {
    supportsFactoryTemplateOwnerIntelligence: () =>
      activeLatte()?.supportsPresenterLinkIntelligence === true,
    detectLattePresenterLinkAt: (source, offset) =>
      activeLatte()?.presenterLinkAt?.({ offset, source }) ?? null,
    lattePresenterLinkCompletionContextAt: (source, offset) =>
      activeLatte()?.presenterLinkCompletionAt?.({ offset, source }) ?? null,
    parsePresenterLinkTarget: (target) =>
      activeLatte()?.parsePresenterLinkTarget?.({ target }) ?? null,
    presenterActionMethodCandidates: (action, isSignal) =>
      activeLatte()?.presenterActionMethodCandidates?.({ action, isSignal }) ??
      [],
    presenterClassCandidatePathsForLink: (target, currentRelativePath) =>
      activeLatte()?.presenterClassCandidatePathsForLink?.({
        currentRelativePath,
        target,
      }) ?? [],
    presenterLinkTargetsFromSource: (path, source) =>
      activeLatte()?.presenterLinkTargetsFromSource?.({ path, source }) ?? [],
    get presenterScanDirectories() {
      return activeLatte()?.presenterScanDirectories ?? [];
    },
    isPresenterSourcePath: (path) =>
      activeLatte()?.isPresenterSourcePath?.({ path }) === true,
    viewDataEntryFromSource: phpFrameworkViewDataEntryFromSource,
    viewDataSearchQueries: phpFrameworkViewDataSearchQueries,
  };
}
