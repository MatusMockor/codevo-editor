import type { ReactNode } from "react";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { ErrorBoundary } from "../ErrorBoundary";
import { AgentRegionFallback } from "./AgentRegionFallback";
import type { AgentRegion } from "./agentRegionFailurePresentation";

export interface AgentRegionBoundaryProps {
  readonly region: AgentRegion;
  readonly clipboard: TextClipboardGateway | null;
  readonly resetKeys: ReadonlyArray<unknown>;
  readonly hidden?: boolean;
  readonly children: ReactNode;
}

export function AgentRegionBoundary({
  region,
  clipboard,
  resetKeys,
  hidden = false,
  children,
}: AgentRegionBoundaryProps) {
  return (
    <ErrorBoundary
      renderFallback={(failure) => (
        <AgentRegionFallback
          clipboard={clipboard}
          failure={failure}
          hidden={hidden}
          region={region}
        />
      )}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}
