const ANSI_FG: Record<number, string> = {
  30: '#4c4c4c', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#767676', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
};
const ANSI_BG: Record<number, string> = {
  40: '#000000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
  44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
  100: '#767676', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
  104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#ffffff',
};

function ansi256ToColor(n: number): string {
  if (n < 16) {
    const p = ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0',
               '#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'];
    return p[n] ?? '#ffffff';
  }
  if (n < 232) {
    const idx = n - 16;
    const b = idx % 6, g = Math.floor(idx / 6) % 6, r = Math.floor(idx / 36);
    const v = (x: number) => x === 0 ? 0 : 55 + x * 40;
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const lv = (n - 232) * 10 + 8;
  return `rgb(${lv},${lv},${lv})`;
}

export interface AnsiStyle { fg: string | null; bg: string | null; bold: boolean; dim: boolean; italic: boolean; underline: boolean; }
export interface AnsiSegment { text: string; style: AnsiStyle; }

function createEmptyStyle(): AnsiStyle {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
}

export function parseAnsiSegments(raw: string): AnsiSegment[] {
  const text = raw
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[ABCDEFGHIJKLMSTPsuhr]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '');

  let style: AnsiStyle = createEmptyStyle();
  const segments: AnsiSegment[] = [];
  const seqRe = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = seqRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) segments.push({ text: before, style: { ...style } });
    lastIndex = match.index + match[0].length;

    const params = match[1] === '' ? [0] : match[1].split(';').map(Number);
    let i = 0;
    while (i < params.length) {
      const c = params[i];
      if (c === 0) style = createEmptyStyle();
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) { style.bold = false; style.dim = false; }
      else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c === 39) style.fg = null;
      else if (c === 49) style.bg = null;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style.fg = ANSI_FG[c] ?? null;
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) style.bg = ANSI_BG[c] ?? null;
      else if (c === 38 && params[i + 1] === 5 && i + 2 < params.length) { style.fg = ansi256ToColor(params[i + 2]); i += 2; }
      else if (c === 38 && params[i + 1] === 2 && i + 4 < params.length) { style.fg = `rgb(${params[i+2]},${params[i+3]},${params[i+4]})`; i += 4; }
      else if (c === 48 && params[i + 1] === 5 && i + 2 < params.length) { style.bg = ansi256ToColor(params[i + 2]); i += 2; }
      else if (c === 48 && params[i + 1] === 2 && i + 4 < params.length) { style.bg = `rgb(${params[i+2]},${params[i+3]},${params[i+4]})`; i += 4; }
      i++;
    }
  }

  const remaining = text.slice(lastIndex);
  if (remaining) segments.push({ text: remaining, style: { ...style } });
  return segments;
}