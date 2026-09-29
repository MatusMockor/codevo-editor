import { useEffect, useLayoutEffect, useRef } from "react";
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";

export type AgentSessionEventSubscription<TEvent> = (
  gateway: AgentThreadSessionGateway,
  handler: (event: TEvent) => void,
) => Promise<() => void>;

export interface AgentSessionEventHandlers<TEvent> {
  readonly onEvent: (event: TEvent) => void;
  readonly onFailure: (error: unknown) => void;
}

export function useAgentSessionEventSubscription<TEvent>(
  gateway: AgentThreadSessionGateway | undefined,
  subscribe: AgentSessionEventSubscription<TEvent>,
  handlers: AgentSessionEventHandlers<TEvent>,
): void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    if (gateway === undefined) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribe(gateway, (event) => {
      if (disposed) return;
      handlersRef.current.onEvent(event);
    }).then(
      (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unsubscribe = stop;
      },
      (error: unknown) => {
        if (disposed) return;
        handlersRef.current.onFailure(error);
      },
    );
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [gateway, subscribe]);
}
