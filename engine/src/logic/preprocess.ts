import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class PreprocessError extends Error {}

export type SymbolKind = 'define' | 'flag' | 'var' | 'view' | 'object' | 'action' | 'test';

export interface SymbolEntry {
  kind: SymbolKind;
  value: number | string;
}

export interface PreprocessResult {
  /** Comment-stripped, include-expanded, macro-substituted logic source. */
  source: string;
  /** Every %define/%flag/%var/%view/%object/%action/%test symbol, resolved to a value. */
  symbols: Record<string, SymbolEntry>;
  /** %message number -> de-wrapped, unescaped message text, for the room being preprocessed. */
  messages: Record<number, string>;
}

interface RawSymbol {
  kind: SymbolKind;
  raw: string;
}

interface Context {
  raw: Map<string, RawSymbol>;
  defineOrder: string[];
  messages: Record<number, string>;
  codeLines: string[];
  visitedFiles: Set<string>;
}

const IDENTIFIER = /[A-Za-z0-9_.'$]+/g;
const DIRECTIVE_LINE = /^\s*%([A-Za-z]+)\s*(.*)$/;
const NAME_VALUE = /^(\S+)\s+(.+)$/;
const ACTION_LIKE = /^(\S+)\(([^)]*)\)\s+(\S+)$/;

function stripCommentOutsideQuotes(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote && ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === '[' && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

function resolveIncludePath(baseDir: string, name: string): string {
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    throw new PreprocessError(`cannot read include directory: ${baseDir}`);
  }
  const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new PreprocessError(`%include not found: "${name}" (looked in ${baseDir})`);
  }
  return join(baseDir, match);
}

// Finds the opening quote starting at lines[startLine][startCol] (skipping
// blank lines first, since a %message directive's string may start a few
// lines below the directive itself), then reads through to the matching
// unescaped closing quote, which may be many lines further along. Raw
// newlines crossed while reading are simply dropped (not replaced with
// anything), since continuation lines already carry their own leading space.
// Only \" is unescaped (to a literal "); every other backslash sequence
// (e.g. the AGI text engine's own "\n" control code) is passed through
// untouched, since that escaping is meaningful to the engine, not to us.
function readQuotedString(
  lines: string[],
  startLine: number,
  startCol = 0
): { value: string; endLine: number } {
  let lineIdx = startLine;
  let col = startCol;
  let quoteCol = -1;
  // Hunt for the opening quote, skipping blank lines and "[" comments
  // trailing the %message directive (e.g. `%message 21    [bird shit`).
  // stripCommentOutsideQuotes only ever truncates a line, so indices found
  // in the stripped text remain valid offsets into the original line.
  while (lineIdx < lines.length) {
    const stripped = stripCommentOutsideQuotes(lines[lineIdx]).slice(col);
    if (stripped.trim() === '') {
      lineIdx++;
      col = 0;
      continue;
    }
    const idx = stripped.indexOf('"');
    if (idx !== -1) {
      quoteCol = col + idx;
    }
    break;
  }
  if (quoteCol === -1) {
    throw new PreprocessError(`expected opening quote, got: ${lines[lineIdx] ?? '<end of input>'}`);
  }
  col = quoteCol + 1;
  let result = '';
  while (true) {
    if (lineIdx >= lines.length) {
      throw new PreprocessError('unterminated quoted string');
    }
    const line = lines[lineIdx];
    while (col < line.length) {
      const ch = line[col];
      if (ch === '\\' && col + 1 < line.length && line[col + 1] === '"') {
        result += '"';
        col += 2;
        continue;
      }
      if (ch === '"') {
        return { value: result, endLine: lineIdx };
      }
      result += ch;
      col++;
    }
    lineIdx++;
    col = 0;
  }
}

function addSymbol(ctx: Context, name: string, kind: SymbolKind, raw: string): void {
  ctx.raw.set(name, { kind, raw });
  ctx.defineOrder.push(name);
}

function processLines(lines: string[], baseDir: string, ctx: Context, label: string): void {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const directiveMatch = DIRECTIVE_LINE.exec(line);
    if (!directiveMatch) {
      // Strip the DOS EOF marker (0x1A / SUB) some of these legacy files
      // (e.g. RM1.MSG) end with; it carries no meaning and would otherwise
      // leak into the code stream as a bogus statement.
      const codeLine = stripCommentOutsideQuotes(line).replace(/\x1a/g, '');
      const trimmed = codeLine.trim();
      // SYSDEFS disables some %action/%var/%define declarations by
      // swapping their leading "%" for "#" rather than removing them
      // outright; treat a "#"-led line as a comment, like "[".
      if (trimmed !== '' && !trimmed.startsWith('#')) {
        ctx.codeLines.push(codeLine);
      }
      i++;
      continue;
    }

    const directive = directiveMatch[1];
    const rest = stripCommentOutsideQuotes(directiveMatch[2]).trim();

    switch (directive) {
      case 'include': {
        const m = /^"([^"]+)"/.exec(rest);
        if (!m) {
          throw new PreprocessError(`malformed %include in ${label}: ${line}`);
        }
        const includePath = resolveIncludePath(baseDir, m[1]);
        if (!ctx.visitedFiles.has(includePath)) {
          ctx.visitedFiles.add(includePath);
          const includedSource = readFileSync(includePath, 'utf-8');
          processLines(splitLines(includedSource), baseDir, ctx, includePath);
        }
        i++;
        break;
      }

      case 'define': {
        const m = NAME_VALUE.exec(rest);
        if (!m) {
          throw new PreprocessError(`malformed %define in ${label}: ${line}`);
        }
        addSymbol(ctx, m[1], 'define', m[2].trim());
        i++;
        break;
      }

      case 'flag':
      case 'var':
      case 'view':
      case 'object': {
        const m = NAME_VALUE.exec(rest);
        if (!m) {
          throw new PreprocessError(`malformed %${directive} in ${label}: ${line}`);
        }
        addSymbol(ctx, m[1], directive as SymbolKind, m[2].trim());
        i++;
        break;
      }

      case 'action':
      case 'test': {
        const m = ACTION_LIKE.exec(rest);
        if (!m) {
          throw new PreprocessError(`malformed %${directive} in ${label}: ${line}`);
        }
        addSymbol(ctx, m[1], directive as SymbolKind, m[3].trim());
        i++;
        break;
      }

      case 'tokens': {
        // Path to the word-token resource; not part of the logic symbol table.
        i++;
        break;
      }

      case 'message': {
        // Use the raw (un-comment-stripped) suffix of the line here: the
        // quoted string may start right on this same line (e.g.
        // `%message 1 "%m10%w1?"`), or several lines below it.
        const numMatch = /^\s*(\d+)/.exec(directiveMatch[2]);
        if (!numMatch) {
          throw new PreprocessError(`malformed %message in ${label}: ${line}`);
        }
        const num = parseInt(numMatch[1], 10);
        const afterNumber = directiveMatch[2].slice(numMatch[0].length);
        const searchLines = [afterNumber, ...lines.slice(i + 1)];
        const { value, endLine: relEndLine } = readQuotedString(searchLines, 0);
        ctx.messages[num] = value;
        i = (relEndLine === 0 ? i : i + relEndLine) + 1;
        break;
      }

      default:
        throw new PreprocessError(`unknown directive %${directive} in ${label}: ${line}`);
    }
  }
}

function resolveSymbol(
  name: string,
  raw: Map<string, RawSymbol>,
  resolved: Map<string, SymbolEntry>,
  visiting: Set<string>
): SymbolEntry {
  const cached = resolved.get(name);
  if (cached) {
    return cached;
  }
  const entry = raw.get(name);
  if (!entry) {
    throw new PreprocessError(`unresolved symbol: ${name}`);
  }
  if (visiting.has(name)) {
    throw new PreprocessError(`circular %define chain detected at: ${name}`);
  }
  visiting.add(name);

  const trimmed = entry.raw.trim();
  let value: number | string;
  if (/^-?\d+$/.test(trimmed)) {
    value = parseInt(trimmed, 10);
  } else if (raw.has(trimmed)) {
    value = resolveSymbol(trimmed, raw, resolved, visiting).value;
  } else {
    value = trimmed;
  }

  visiting.delete(name);
  const result: SymbolEntry = { kind: entry.kind, value };
  resolved.set(name, result);
  return result;
}

function substituteMacros(text: string, macros: Map<string, string>): string {
  if (macros.size === 0) {
    return text;
  }
  let result = text;
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    result = result.replace(IDENTIFIER, (token) => {
      const replacement = macros.get(token);
      if (replacement === undefined) {
        return token;
      }
      changed = true;
      return replacement;
    });
    if (!changed) {
      break;
    }
  }
  return result;
}

function finish(ctx: Context): PreprocessResult {
  const resolved = new Map<string, SymbolEntry>();
  for (const name of ctx.defineOrder) {
    resolveSymbol(name, ctx.raw, resolved, new Set());
  }

  const macros = new Map<string, string>();
  for (const [name, entry] of ctx.raw) {
    if (entry.kind === 'define') {
      macros.set(name, entry.raw.trim());
    }
  }

  const source = substituteMacros(ctx.codeLines.join('\n'), macros);

  const symbols: Record<string, SymbolEntry> = {};
  for (const [name, entry] of resolved) {
    symbols[name] = entry;
  }

  return { source, symbols, messages: ctx.messages };
}

export function preprocessSource(source: string, baseDir: string, label = '<source>'): PreprocessResult {
  const ctx: Context = {
    raw: new Map(),
    defineOrder: [],
    messages: {},
    codeLines: [],
    visitedFiles: new Set(),
  };
  processLines(splitLines(source), baseDir, ctx, label);
  return finish(ctx);
}

export function preprocessFile(entryPath: string, baseDir: string = dirname(entryPath)): PreprocessResult {
  const source = readFileSync(entryPath, 'utf-8');
  const ctx: Context = {
    raw: new Map(),
    defineOrder: [],
    messages: {},
    codeLines: [],
    visitedFiles: new Set([entryPath]),
  };
  processLines(splitLines(source), baseDir, ctx, entryPath);
  return finish(ctx);
}
