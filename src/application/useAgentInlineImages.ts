import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createAgentInlineImageStore,
  type AgentInlineImageStore,
  type AgentInlineImagesSurface,
} from "./agentInlineImageStore";
import type { AgentInlineImageGateway } from "./agentInlineImagePorts";

export {
  AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON,
  AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
  MAX_AGENT_INLINE_IMAGE_CACHE_BYTES,
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  MAX_AGENT_INLINE_IMAGE_PINS,
  MAX_AGENT_INLINE_IMAGE_RETAINED_FAILURES,
  type AgentInlineImageIdentity,
  type AgentInlineImageState,
  type AgentInlineImageThreadOwner,
} from "./agentInlineImageCache";
export {
  AGENT_INLINE_IMAGE_DECODE_FAILED_REASON,
  AGENT_INLINE_IMAGE_NO_GATEWAY_REASON,
  AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
  AGENT_INLINE_IMAGE_TOO_LARGE_REASON,
  AGENT_INLINE_IMAGE_UNREADABLE_REASON,
  AGENT_INLINE_IMAGE_UNSUPPORTED_REASON,
  MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS,
  MAX_AGENT_INLINE_IMAGE_WAITING,
  agentInlineImageUnavailableReason,
  type AgentInlineImageSize,
  type AgentInlineImagesSurface,
} from "./agentInlineImageStore";

export interface AgentInlineImagesDependencies {
  readonly gateway: AgentInlineImageGateway | null;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export function useAgentInlineImages(
  dependencies: AgentInlineImagesDependencies,
): AgentInlineImagesSurface {
  const dependenciesRef = useRef(dependencies);
  const [store] = useState<AgentInlineImageStore>(() =>
    createAgentInlineImageStore({
      gateway: () => dependenciesRef.current.gateway,
      createObjectUrl: (blob) =>
        (dependenciesRef.current.createObjectUrl ?? defaultCreateObjectUrl)(blob),
      revokeObjectUrl: (url) =>
        (dependenciesRef.current.revokeObjectUrl ?? defaultRevokeObjectUrl)(url),
    }),
  );

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => () => store.dispose(), [store]);

  return store;
}

function defaultCreateObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}
