import { useCallback, useEffect, useRef, useState } from "react";

interface UseNodeLaunchConfigurationsSurfaceOptions {
  readonly available: boolean;
  readonly ownerKey: string | null;
  closeDebugPicker(): void;
  closeRunPicker(): void;
}

export interface NodeLaunchConfigurationsSurface {
  readonly nodeLaunchConfigurationsOpen: boolean;
  closeNodeLaunchConfigurations(): void;
  openNodeLaunchConfigurations(): void;
}

/** Owner-scoped controller for the launch-configuration settings surface. */
export function useNodeLaunchConfigurationsSurface({
  available,
  ownerKey,
  closeDebugPicker,
  closeRunPicker,
}: UseNodeLaunchConfigurationsSurfaceOptions): NodeLaunchConfigurationsSurface {
  const currentRef = useRef({ available, closeDebugPicker, closeRunPicker, ownerKey });
  currentRef.current = { available, closeDebugPicker, closeRunPicker, ownerKey };
  const [openOwnerKey, setOpenOwnerKey] = useState<string | null>(null);

  useEffect(() => {
    setOpenOwnerKey(null);
  }, [available, ownerKey]);

  const closeNodeLaunchConfigurations = useCallback(() => {
    setOpenOwnerKey(null);
  }, []);

  const openNodeLaunchConfigurations = useCallback(() => {
    const current = currentRef.current;
    if (!current.available || !current.ownerKey) return;

    current.closeDebugPicker();
    current.closeRunPicker();
    setOpenOwnerKey(current.ownerKey);
  }, []);

  return {
    nodeLaunchConfigurationsOpen: available && ownerKey !== null && openOwnerKey === ownerKey,
    closeNodeLaunchConfigurations,
    openNodeLaunchConfigurations,
  };
}
