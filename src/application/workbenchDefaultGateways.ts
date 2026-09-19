import { TauriAgentAttachmentGateway } from "../infrastructure/tauriAgentAttachmentGateway";
import { TauriAgentTaskGateway } from "../infrastructure/tauriAgentTaskGateway";
import { TauriAgentThreadStoreGateway } from "../infrastructure/tauriAgentThreadStoreGateway";
import { TauriAgentTurnLogGateway } from "../infrastructure/tauriAgentTurnLogGateway";
import { TauriDebugGateway } from "../infrastructure/tauriDebugGateway";
import { TauriEslintDiagnosticsGateway } from "../infrastructure/tauriEslintDiagnosticsGateway";
import { TauriExternalSessionGateway } from "../infrastructure/tauriExternalSessionGateway";
import {
  TauriCompareUrlOpener,
  TauriGitIntegrationGateway,
} from "../infrastructure/tauriGitIntegrationGateway";
import { TauriGitWorktreeGateway } from "../infrastructure/tauriGitWorktreeGateway";
import { TauriPhpstanDiagnosticsGateway } from "../infrastructure/tauriPhpstanDiagnosticsGateway";
import { TauriPhpSyntaxDiagnosticsGateway } from "../infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriPintGateway } from "../infrastructure/tauriPintGateway";
import { TauriPrettierGateway } from "../infrastructure/tauriPrettierGateway";
import { WebviewAgentImageSurface } from "../infrastructure/webviewAgentImageSurface";
import type { AgentTurnLogEvidenceLookup } from "../domain/agentTurnContentLoss";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";

export const defaultAgentAttachmentGateway = new TauriAgentAttachmentGateway();
export const defaultAgentTaskGateway = new TauriAgentTaskGateway();
export function createDefaultAgentThreadStoreGateway(
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentThreadStoreGateway {
  return new TauriAgentThreadStoreGateway(undefined, undefined, evidenceOf);
}
export const defaultAgentTurnLogGateway = new TauriAgentTurnLogGateway();
export const defaultDebugGateway = new TauriDebugGateway();
export const defaultExternalSessionGateway = new TauriExternalSessionGateway();
export const defaultGitWorktreeGateway = new TauriGitWorktreeGateway();
export const defaultGitIntegrationGateway = new TauriGitIntegrationGateway();
export const defaultCompareUrlOpener = new TauriCompareUrlOpener();
export const defaultPrettierFormattingGateway = new TauriPrettierGateway();
export const eslintDiagnosticsGateway = new TauriEslintDiagnosticsGateway();
export const phpLocalSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();
export const phpstanDiagnosticsGateway = new TauriPhpstanDiagnosticsGateway();
export const pintGateway = new TauriPintGateway();
export const defaultAgentImageSurface = new WebviewAgentImageSurface();
