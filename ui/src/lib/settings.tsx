import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemePref = "dark" | "light" | "system";
export type BadgeMetric =
  | "loc"
  | "test_count"
  | "complexity"
  | "cohesion"
  | "column_count"
  | "downstream_count"
  | "none";

export interface UISettings {
  theme: ThemePref;
  badgeMetric: BadgeMetric;
  showColumnFractions: boolean;
  minimap: boolean;
  sidebarExpanded: boolean;
}

const DEFAULTS: UISettings = {
  theme: "dark",
  badgeMetric: "loc",
  showColumnFractions: true,
  minimap: true,
  sidebarExpanded: true,
};

const KEY = "dbtsteroids-settings";

function load(): UISettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function resolveTheme(t: ThemePref): "light" | "dark" {
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

interface Ctx {
  settings: UISettings;
  update: (patch: Partial<UISettings>) => void;
  resolvedTheme: "light" | "dark";
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UISettings>(load);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(load().theme));

  const update = useCallback((patch: Partial<UISettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore quota/private-mode errors */
      }
      return next;
    });
  }, []);

  // Apply the resolved theme to <html data-theme> (CSS overrides key on it), and
  // track OS changes while in "system" mode.
  useEffect(() => {
    const apply = () => {
      const r = resolveTheme(settings.theme);
      setResolvedTheme(r);
      document.documentElement.dataset.theme = r;
    };
    apply();
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme]);

  const value = useMemo(() => ({ settings, update, resolvedTheme }), [settings, update, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

/** Read the current theme's color tokens as JS values, for consumers that can't
 * use CSS vars directly (React Flow Background, recharts). Recomputes on theme change. */
export function useThemeTokens() {
  const { resolvedTheme } = useSettings();
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when theme flips
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n: string) => cs.getPropertyValue(n).trim() || undefined;
    return {
      bg: get("--color-bg") ?? "#0b0f17",
      border: get("--color-border") ?? "#223049",
      panel: get("--color-panel") ?? "#111826",
      panel2: get("--color-panel-2") ?? "#161f30",
      muted: get("--color-muted") ?? "#8595ad",
      fg: get("--color-fg") ?? "#e6ecf5",
      accent: get("--color-accent") ?? "#4f8cff",
    };
  }, [resolvedTheme]);
}
