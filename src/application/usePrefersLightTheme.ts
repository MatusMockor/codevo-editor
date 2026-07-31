import { useEffect, useState } from "react";

const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

export function usePrefersLightTheme(): boolean {
  const [prefersLight, setPrefersLight] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    if (!window.matchMedia) {
      return false;
    }

    return window.matchMedia(LIGHT_SCHEME_QUERY).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }

    const media = window.matchMedia(LIGHT_SCHEME_QUERY);
    const updatePreference = () => setPrefersLight(media.matches);

    updatePreference();
    media.addEventListener("change", updatePreference);

    return () => media.removeEventListener("change", updatePreference);
  }, []);

  return prefersLight;
}
