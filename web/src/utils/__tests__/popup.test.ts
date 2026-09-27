import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readPopupSize, openPopup, trackPopupSize, isPopupWindow } from '../popup';

type ResizeHandler = () => void;

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    store,
  };
}

function fakeWindow() {
  const listeners = new Set<ResizeHandler>();
  const open = vi.fn(() => ({}) as Window);
  const win = {
    outerWidth: 0,
    outerHeight: 0,
    open,
    addEventListener: (type: string, handler: ResizeHandler) => {
      if (type === 'resize') listeners.add(handler);
    },
    removeEventListener: (type: string, handler: ResizeHandler) => {
      if (type === 'resize') listeners.delete(handler);
    },
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  };
  return { win, open, emitResize: () => listeners.forEach(h => h()), listenerCount: () => listeners.size };
}

describe('readPopupSize', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('returns per-kind defaults when nothing is stored', () => {
    expect(readPopupSize('logs')).toEqual({ width: 900, height: 700 });
    expect(readPopupSize('terminal')).toEqual({ width: 900, height: 700 });
  });

  it('returns a fallback when provided and nothing is stored', () => {
    expect(readPopupSize('terminal', { width: 960, height: 640 })).toEqual({ width: 960, height: 640 });
  });

  it('returns the stored size', () => {
    localStorage.setItem('popup-size:logs', JSON.stringify({ width: 1234, height: 456 }));
    expect(readPopupSize('logs')).toEqual({ width: 1234, height: 456 });
  });

  it('falls back when the stored value is malformed or invalid', () => {
    localStorage.setItem('popup-size:logs', 'not json');
    expect(readPopupSize('logs')).toEqual({ width: 900, height: 700 });

    localStorage.setItem('popup-size:logs', JSON.stringify({ width: -1, height: 0 }));
    expect(readPopupSize('logs')).toEqual({ width: 900, height: 700 });

    localStorage.setItem('popup-size:logs', JSON.stringify({ width: '900', height: 700 }));
    expect(readPopupSize('logs')).toEqual({ width: 900, height: 700 });
  });
});

describe('openPopup', () => {
  let env: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    env = fakeWindow();
    vi.stubGlobal('window', env.win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens with the remembered size', () => {
    localStorage.setItem('popup-size:logs', JSON.stringify({ width: 1111, height: 777 }));
    openPopup('logs', '/logs?a=b');
    expect(env.open).toHaveBeenCalledWith(
      '/logs?a=b',
      '_blank',
      'width=1111,height=777,resizable=yes,scrollbars=yes',
    );
  });

  it('opens with the fallback size when nothing is remembered', () => {
    openPopup('terminal', '/terminal', { width: 960, height: 640 });
    expect(env.open).toHaveBeenCalledWith(
      '/terminal',
      '_blank',
      'width=960,height=640,resizable=yes,scrollbars=yes',
    );
  });
});

describe('isPopupWindow', () => {
  it('is true only for a window opened by another window', () => {
    expect(isPopupWindow({ opener: {} } as unknown as Window)).toBe(true);
    expect(isPopupWindow({ opener: null } as unknown as Window)).toBe(false);
  });
});

describe('trackPopupSize', () => {
  let env: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', memoryStorage());
    env = fakeWindow();
    vi.stubGlobal('window', env.win);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('persists the outer size on resize after debounce', () => {
    const stop = trackPopupSize('terminal');
    vi.advanceTimersByTime(500);
    env.win.outerWidth = 1000;
    env.win.outerHeight = 800;
    env.emitResize();
    expect(localStorage.getItem('popup-size:terminal')).toBeNull();
    vi.advanceTimersByTime(250);
    expect(readPopupSize('terminal')).toEqual({ width: 1000, height: 800 });
    stop();
  });

  it('ignores the transient resize fired while opening', () => {
    const stop = trackPopupSize('logs');
    env.win.outerWidth = 500;
    env.win.outerHeight = 500;
    env.emitResize();
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem('popup-size:logs')).toBeNull();
    stop();
  });

  it('removes its listener on cleanup', () => {
    const stop = trackPopupSize('logs');
    expect(env.listenerCount()).toBe(1);
    stop();
    expect(env.listenerCount()).toBe(0);
  });
});
