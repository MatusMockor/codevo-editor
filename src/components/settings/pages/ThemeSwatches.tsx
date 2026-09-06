import { useRef, type KeyboardEvent } from "react";
import { appThemeOptions, type AppTheme } from "../../../domain/settings";

interface ThemePalette {
  readonly app: string;
  readonly sidebar: string;
  readonly accent: string;
}

const THEME_PALETTES: Readonly<Record<AppTheme, ThemePalette>> = {
  dark: { app: "#13151a", sidebar: "#0c0d10", accent: "#4fcdb3" },
  light: { app: "#f0f2f5", sidebar: "#fbfcfd", accent: "#13836f" },
  system: { app: "#13151a", sidebar: "#fbfcfd", accent: "#4fcdb3" },
  ayuMirage: { app: "#1f2430", sidebar: "#1f2430", accent: "#ffcc66" },
  materialDeepOcean: { app: "#0f111a", sidebar: "#0f111a", accent: "#84ffff" },
  oneDarkPro: { app: "#282c34", sidebar: "#282c34", accent: "#61afef" },
  dracula: { app: "#282a36", sidebar: "#282a36", accent: "#bd93f9" },
  catppuccinMocha: { app: "#1e1e2e", sidebar: "#1e1e2e", accent: "#cba6f7" },
  catppuccinLatte: { app: "#eff1f5", sidebar: "#eff1f5", accent: "#8839ef" },
  oneLight: { app: "#fafafa", sidebar: "#fafafa", accent: "#4078f2" },
  darkPlus: { app: "#1e1e1e", sidebar: "#252526", accent: "#007acc" },
};

const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export interface ThemeSwatchesProps {
  readonly value: AppTheme;
  onChange(theme: AppTheme): void;
}

export function ThemeSwatches({ onChange, value }: ThemeSwatchesProps) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextTheme(event.key, value);

    if (next === null) return;

    event.preventDefault();
    onChange(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };

  return (
    <div
      aria-label="Theme preview"
      className="settings-swatches"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {appThemeOptions.map((theme) => {
        const palette = THEME_PALETTES[theme.id];

        return (
          <button
            aria-checked={theme.id === value}
            aria-label={theme.label}
            className="settings-swatch"
            data-value={theme.id}
            key={theme.id}
            onClick={() => onChange(theme.id)}
            role="radio"
            style={{ background: palette.app }}
            tabIndex={theme.id === value ? 0 : -1}
            title={theme.label}
            type="button"
          >
            <span
              aria-hidden="true"
              className="settings-swatch__sidebar"
              style={{ background: palette.sidebar }}
            />
            <span
              aria-hidden="true"
              className="settings-swatch__accent"
              style={{ background: palette.accent }}
            />
          </button>
        );
      })}
    </div>
  );
}

function nextTheme(key: string, value: AppTheme): AppTheme | null {
  const first = appThemeOptions[0];
  const last = appThemeOptions[appThemeOptions.length - 1];

  if (first === undefined || last === undefined) return null;
  if (key === "Home") return first.id;
  if (key === "End") return last.id;

  const step = STEP_BY_KEY[key];

  if (step === undefined) return null;

  const current = appThemeOptions.findIndex((theme) => theme.id === value);
  const next =
    appThemeOptions[
      (Math.max(current, 0) + step + appThemeOptions.length) % appThemeOptions.length
    ];

  return next === undefined ? null : next.id;
}
