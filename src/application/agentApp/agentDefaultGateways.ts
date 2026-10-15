import { TauriAgentAttachmentGateway } from "../../infrastructure/tauriAgentAttachmentGateway";
import { TauriAgentTaskGateway } from "../../infrastructure/tauriAgentTaskGateway";
import { TauriAgentHistoryGateway } from "../../infrastructure/tauriAgentHistoryGateway";
import { TauriExternalSessionImportGateway } from "../../infrastructure/tauriExternalSessionImportGateway";
import { TauriAgentHistoryCatalogGateway } from "../../infrastructure/tauriAgentHistoryCatalogGateway";
import { TauriAgentTurnLogGateway } from "../../infrastructure/tauriAgentTurnLogGateway";
import { TauriExternalSessionGateway } from "../../infrastructure/tauriExternalSessionGateway";
import {
  TauriCompareUrlOpener,
  TauriGitIntegrationGateway,
} from "../../infrastructure/tauriGitIntegrationGateway";
import { TauriGitWorktreeGateway } from "../../infrastructure/tauriGitWorktreeGateway";
import { WebviewAgentImageSurface } from "../../infrastructure/webviewAgentImageSurface";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import type { AgentThreadStoreGateway } from "../agentThreadPorts";

export const defaultAgentAttachmentGateway = new TauriAgentAttachmentGateway();
export const defaultAgentTaskGateway = new TauriAgentTaskGateway();
export const defaultSessionImportGateway = new TauriExternalSessionImportGateway();
export const defaultHistoryCatalogGateway = new TauriAgentHistoryCatalogGateway();
export function createDefaultAgentThreadStoreGateway(
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentThreadStoreGateway {
  return new TauriAgentHistoryGateway(undefined, undefined, evidenceOf);
}
export const defaultAgentTurnLogGateway = new TauriAgentTurnLogGateway();
export const defaultExternalSessionGateway = new TauriExternalSessionGateway();
export const defaultGitWorktreeGateway = new TauriGitWorktreeGateway();
export const defaultGitIntegrationGateway = new TauriGitIntegrationGateway();
export const defaultCompareUrlOpener = new TauriCompareUrlOpener();
export const defaultAgentImageSurface = new WebviewAgentImageSurface();
