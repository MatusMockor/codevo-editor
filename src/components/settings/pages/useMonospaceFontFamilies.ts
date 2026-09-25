import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemFontGateway } from "../../../domain/systemFonts";
import { uniqueSortedStrings } from "../../settingsDialogValues";

export interface MonospaceFontFamilies {
  readonly options: ReadonlyArray<string>;
  refresh(): void;
}

export function useMonospaceFontFamilies(
  gateway: SystemFontGateway,
  currentFamily: string,
): MonospaceFontFamilies {
  const [loaded, setLoaded] = useState<ReadonlyArray<string>>([]);
  const requestRef = useRef(0);
  const options = useMemo(
    () => uniqueSortedStrings([...loaded, currentFamily]),
    [currentFamily, loaded],
  );

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    try {
      const families = await gateway.listMonospaceFontFamilies();

      if (requestRef.current !== requestId) return;

      setLoaded(uniqueSortedStrings(families));
    } catch {
      if (requestRef.current !== requestId) return;

      setLoaded([]);
    }
  }, [gateway]);

  useEffect(() => {
    void load();
  }, [load]);

  return { options, refresh: () => void load() };
}
