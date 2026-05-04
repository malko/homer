import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

export const THEME_DEFINITIONS = [
  { id: 'homer-light',       label: 'Homer Light',         dark: false, family: 'homer' },
  { id: 'homer-dark',          label: 'Homer Dark',          dark: true,  family: 'homer' },
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

const DEFAULT_DARK: ThemeId  = 'homer-dark';
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

export async function getThemeForInstance(instanceId: string): Promise<ThemeId> {
  // Try API first
  try {
    const response = await api.auth.getThemePreferences();
    const pref = response.preferences?.find((p: { instance_id: string; theme_id: string }) => p.instance_id === instanceId);
    if (pref?.theme_id && THEME_DEFINITIONS.some(t => t.id === pref.theme_id)) {
      // Cache in localStorage
      const key = instanceId === 'local' ? 'color-theme' : `color-theme-${instanceId}`;
      localStorage.setItem(key, pref.theme_id);
      return pref.theme_id as ThemeId;
    }
  } catch {
    // API failed, fallback to localStorage
  }

  // Fallback to localStorage
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
  // Save to API in background
  api.auth.setThemePreference(instanceId, themeId).catch(() => {});
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
  const [themeId, setThemeState] = useState<ThemeId>(DEFAULT_DARK);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    getThemeForInstance('local').then(id => {
      setThemeState(id);
      setInitialized(true);
    }).catch(() => setInitialized(true));
  }, []);

  useEffect(() => {
    if (initialized) {
      applyTheme(themeId);
    }
  }, [themeId, initialized]);

  function setThemeId(id: ThemeId) {
    setThemeForInstance('local', id);
    setThemeState(id);
  }

  function toggleTheme() {
    const next = toggleVariant(themeId);
    setThemeId(next);
  }

  if (!initialized) return null;

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

export async function applyInstanceTheme(instanceId: string) {
  const themeId = await getThemeForInstance(instanceId);
  document.documentElement.setAttribute('data-theme', themeId);
  return themeId;
}

// Initialize theme on load (call once at app start)
getThemeForInstance('local').then(themeId => {
  document.documentElement.setAttribute('data-theme', themeId);
}).catch(() => {});
