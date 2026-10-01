import { useEffect, useInsertionEffect, useLayoutEffect, useState } from "react";
import {
  createAgentThreadNotificationCenter,
  type AgentThreadNotificationCenter,
  type AgentThreadNotificationCenterPorts,
} from "./agentThreadNotificationCenter";

export interface AgentThreadNotificationCenterOptions {
  readonly enabled: boolean;
  readonly toastsVisible: boolean;
  readonly threadViewVisible: boolean;
}

export function useAgentThreadNotificationCenter(
  { enabled, threadViewVisible, toastsVisible }: AgentThreadNotificationCenterOptions,
  createPorts: () => AgentThreadNotificationCenterPorts,
): AgentThreadNotificationCenter {
  const [center] = useState(() => createAgentThreadNotificationCenter(createPorts()));
  useLayoutEffect(() => {
    center.setEnabled(enabled);
  }, [center, enabled]);
  useInsertionEffect(() => {
    center.setPresentation({ toastsVisible, threadViewVisible });
  }, [center, threadViewVisible, toastsVisible]);
  useLayoutEffect(() => {
    center.flush();
  }, [center, threadViewVisible, toastsVisible]);
  useEffect(() => center.start(), [center]);
  return center;
}
