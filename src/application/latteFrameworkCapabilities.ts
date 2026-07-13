import {
  detectLatteLinkAt,
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
  lattePresenterLinkCompletionContextAt: (source, offset) =>
    nettePresenterLinkCompletionContextAt(source, offset, "latte"),
  parsePresenterLinkTarget: parseNetteLinkTarget,
  presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
  presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
  presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
  presenterScanDirectories: ["app"],
  isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
  viewDataEntryFromSource: phpFrameworkViewDataEntryFromSource,
  viewDataSearchQueries: phpFrameworkViewDataSearchQueries,
};
