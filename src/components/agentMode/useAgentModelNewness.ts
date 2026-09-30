import { createContext, useContext } from "react";
import { NO_MODEL_NEWNESS } from "../../application/modelNewness";

export const ModelNewnessContext = createContext(NO_MODEL_NEWNESS);

export function useAgentModelNewness() {
  return useContext(ModelNewnessContext);
}
