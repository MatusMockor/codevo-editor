import { TauriAgentTaskGateway } from "../infrastructure/tauriAgentTaskGateway";
import { TauriDebugGateway } from "../infrastructure/tauriDebugGateway";
import { TauriEslintDiagnosticsGateway } from "../infrastructure/tauriEslintDiagnosticsGateway";
import { TauriGitWorktreeGateway } from "../infrastructure/tauriGitWorktreeGateway";
import { TauriPhpstanDiagnosticsGateway } from "../infrastructure/tauriPhpstanDiagnosticsGateway";
import { TauriPhpSyntaxDiagnosticsGateway } from "../infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriPintGateway } from "../infrastructure/tauriPintGateway";
import { TauriPrettierGateway } from "../infrastructure/tauriPrettierGateway";

export const defaultAgentTaskGateway = new TauriAgentTaskGateway();
export const defaultDebugGateway = new TauriDebugGateway();
export const defaultGitWorktreeGateway = new TauriGitWorktreeGateway();
export const defaultPrettierFormattingGateway = new TauriPrettierGateway();
export const eslintDiagnosticsGateway = new TauriEslintDiagnosticsGateway();
export const phpLocalSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();
export const phpstanDiagnosticsGateway = new TauriPhpstanDiagnosticsGateway();
export const pintGateway = new TauriPintGateway();
