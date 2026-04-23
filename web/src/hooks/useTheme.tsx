import { createContext, useContext, useEffect, useState } from 'react';

export const THEME_DEFINITIONS = [
  { id: 'homer-light',       label: 'Homer Light',         dark: false, family: 'homer' },
  { id: 'homer-de',          label: 'Homer Dark',          dark: true,  family: 'homer' },
  { id: 'homer-ta',          label: 'Homer Terminal',      dark: true,  family: 'homer' },
  { id: 'tango-light',       label: 'Tango Light',         dark: false, family: 'tango' },
  { id: 'tango-dark',        label: 'Tango Dark',          dark: true,  family: 'tango' },
  { id: 'solarized-light',   label: 'Solarized Light',     dark: false, family: 'solarized' },
  { id: 'solarized-dark',    label: 'Solarized Dark',      dark: true,  family: 'solarized' },
  { id: 'nord-light',        label: 'Nord Light',          dark: false, family: 'nord' },
  { id: 'nord-dark',         label: 'Nord Dark',           dark: true,  family: 'nord' },
  { id: 'gruvbox-light',     label: 'Gruvbox Light',       dark: false, family: 'gruvbox' },
  { id: 'gruvbox-dark',      label: 'Gruvbox Dark',        dark: true,  family: 'gruvbox' },
  { id: 'dracula-light',     label: 'Dracula Light',       dark: false, family: 'dracula' },
  { id: 'dracula',           label: 'Dracula',             dark: true,  family: 'dracula' },
  { id: 'catppuccin-latte',  label: 'Catppuccin Latte',   dark: false, family: 'catppuccin' },
  { id: 'catppuccin-mocha',  label: 'Catppuccin Mocha',   dark: true,  family: 'catppuccin' },
  { id: 'tokyo-day',         label: 'Tokyo Day',           dark: false, family: 'tokyo-night' },
  { id: 'tokyo-night',       label: 'Tokyo Night',         dark: true,  family: 'tokyo-night' },
] as const;

export type ThemeId = typeof THEME_DEFINITIONS[number]['id'];

const DEFAULT_DARK: ThemeId  = 'homer-de';
const DEFAULT_LIGHT: ThemeId = 'homer-light';

function isDark(id: ThemeId): boolean {
  return THEME_DEFINITIONS.find(t => t.id === id)?.dark ?? false;
}

function toggleVariant(id: ThemeId): ThemeId {
  const def = THEME_DEFINITIONS.find(t => t.id === id);
  if (!def) return id;
  const sibling = THEME_DEFINITIONS.find(t => t.family === def.family && t.dark !== def.dark);
  return (sibling?.id as ThemeId) ?? (def.dark ? DEFAULT_LIGHT : DEFAULT_DARK);
}

export function getThemeForInstance(instanceId: string): ThemeId {
  const key = instanceId === 'local' ? 'color-theme' : `color-theme-${instanceId}`;
  const stored = localStorage.getItem(key) as ThemeId | null;
  if (stored && THEME_DEFINITIONS.some(t => t.id === stored)) return stored;
  // backward compat: old 'theme' key
  if (instanceId === 'local') {
    const old = localStorage.getItem('theme');
    if (old === 'dark') return DEFAULT_DARK;
    if (old === 'light') return DEFAULT_LIGHT;
  }
  return DEFAULT_DARK;
}

export function setThemeForInstance(instanceId: string, themeId: ThemeId) {
  const key = instanceId === 'local' ? 'color-theme' : `color-theme-${instanceId}`;
  localStorage.setItem(key, themeId);
}

function applyTheme(themeId: ThemeId) {
  document.documentElement.setAttribute('data-theme', themeId);
}

interface ThemeContextValue {
  themeId: ThemeId;
  resolvedDark: boolean;
  setThemeId: (id: ThemeId) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeState] = useState<ThemeId>(() => getThemeForInstance('local'));

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  function setThemeId(id: ThemeId) {
    setThemeForInstance('local', id);
    setThemeState(id);
  }

  function toggleTheme() {
    const next = toggleVariant(themeId);
    setThemeId(next);
  }

  return (
    <ThemeContext.Provider value={{ themeId, resolvedDark: isDark(themeId), setThemeId, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function applyInstanceTheme(instanceId: string) {
  const themeId = getThemeForInstance(instanceId);
  document.documentElement.setAttribute('data-theme', themeId);
  return themeId;
}
