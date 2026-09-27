/**
 * Remember the size of popup windows (logs, terminal) in localStorage so that
 * reopening a popup restores the last size the user set.
 */

export type PopupKind = 'logs' | 'terminal';

export interface PopupSize {
  width: number;
  height: number;
}

const STORAGE_PREFIX = 'popup-size:';

const DEFAULTS: Record<PopupKind, PopupSize> = {
  logs: { width: 900, height: 700 },
  terminal: { width: 900, height: 700 },
};

function storageKey(kind: PopupKind): string {
  return `${STORAGE_PREFIX}${kind}`;
}

export function readPopupSize(kind: PopupKind, fallback?: PopupSize): PopupSize {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PopupSize>;
      if (
        typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0 &&
        typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 0
      ) {
        return { width: parsed.width, height: parsed.height };
      }
    }
  } catch {
    // Ignore malformed or unavailable storage and fall back to defaults
  }
  return fallback ?? DEFAULTS[kind];
}

export function openPopup(kind: PopupKind, url: string, fallback?: PopupSize): Window | null {
  const { width, height } = readPopupSize(kind, fallback);
  const features = `width=${width},height=${height},resizable=yes,scrollbars=yes`;
  return window.open(url, '_blank', features);
}

/**
 * True when this window was opened as a popup (logs/terminal) by another HOMER
 * window. Popups must stay silent: no web notifications, no update banner.
 */
export function isPopupWindow(win: Pick<Window, 'opener'> = window): boolean {
  return win.opener != null;
}

/**
 * Persist the popup's current outer size on resize. Returns a cleanup function.
 * Call from the popup page itself (LogsPage / TerminalPage).
 */
export function trackPopupSize(kind: PopupKind): () => void {
  let initialised = false;
  let timer: number | undefined;

  const save = () => {
    const width = window.outerWidth;
    const height = window.outerHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    try {
      localStorage.setItem(storageKey(kind), JSON.stringify({ width, height }));
    } catch {
      // Ignore storage failures (private mode, quota, ...)
    }
  };

  const onResize = () => {
    // Skip the transient resize fired while the window is being opened
    if (!initialised) return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(save, 250);
  };

  const initTimer = window.setTimeout(() => { initialised = true; }, 500);

  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    window.clearTimeout(initTimer);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
