import {
  detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  nettePresenterLinkCompletionContextAt,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
} from "../domain/phpFrameworkProviders";
import { isNettePresenterDiscoverySourcePath } from "./nettePresenterLinkDiscovery";
import { nettePresenterLinkTargetsFromSource } from "./nettePresenterLinkDiscovery";
import type { LatteFrameworkCapabilities } from "./latteIntelligenceContracts";

export const netteLatteFrameworkCapabilities: LatteFrameworkCapabilities = {
  detectLattePresenterLinkAt: detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  parsePresenterLinkTarget: parseNetteLinkTarget,
  presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
  presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
  presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
  presenterScanDirectories: ["app"],
  isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
  presenterLinkCompletionContextAt: nettePresenterLinkCompletionContextAt,
  viewDataEntryFromSource: phpFrameworkViewDataEntryFromSource,
  viewDataSearchQueries: phpFrameworkViewDataSearchQueries,
};
