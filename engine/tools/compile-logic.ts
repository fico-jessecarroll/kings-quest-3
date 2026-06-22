// Compiles every SRC/RM*.CG logic source into a single bundled IR artifact,
// plus the global symbol tables and per-room message tables it depends on.
// Run via `npm run build:logic`; writes its output under
// engine/src/generated/.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preprocessFile, type SymbolEntry } from '../src/logic/preprocess';
import { parseLogic } from '../src/logic/parser';
import type { Statement } from '../src/logic/ir';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const DEFAULT_SRC_DIR = join(REPO_ROOT, 'SRC');
export const OUT_DIR = join(__dirname, '..', 'src', 'generated');

// Every room transitively re-includes these through its own %include chain,
// so resolving them here once (rather than re-deriving the global tables
// from each of the 124 per-room preprocessor passes) avoids 124x redundant
// header parsing and guarantees one consistent global table regardless of
// which subset of headers a given room happens to pull in directly.
const SHARED_HEADERS = [
  'GAMEDEFS.AL', // -> DEFINES.AL, GAMEDEFS.H (-> SYSDEFS, SYSDEFS.AL), VIEWS.H
  'GAMEDEFS.REH', // Bob Heitman's extra flags/defines (170+)
  'RM-NAMES.H',
  'IV-NAMES.H',
  'IV-VIEWS.H',
  'COLORS.H',
  'CONTRLRS.H',
];

export interface GlobalSymbolTables {
  flags: Record<string, number>;
  vars: Record<string, number>;
  views: Record<string, number>;
  objects: Record<string, number>;
  roomNames: Record<string, number>;
  defines: Record<string, number>;
}

export interface RoomArtifact {
  room: number;
  file: string;
  name?: string;
  statements: Statement[];
  /** Symbols declared by this room itself (or pulled in beyond the shared headers above) - local labels, %define aliases, etc. */
  localSymbols: Record<string, SymbolEntry>;
}

export interface LogicBundle {
  rooms: RoomArtifact[];
}

export interface CompileFailure {
  file: string;
  error: string;
}

export interface CompileReport {
  totalFiles: number;
  succeeded: number;
  failures: CompileFailure[];
}

export interface CompileResult {
  bundle: LogicBundle;
  symbols: GlobalSymbolTables;
  messages: Record<number, Record<number, string>>;
  report: CompileReport;
}

function buildGlobalSymbolTables(srcDir: string): GlobalSymbolTables {
  const flags: Record<string, number> = {};
  const vars: Record<string, number> = {};
  const views: Record<string, number> = {};
  const objects: Record<string, number> = {};
  const roomNames: Record<string, number> = {};
  const defines: Record<string, number> = {};

  for (const header of SHARED_HEADERS) {
    const { symbols } = preprocessFile(join(srcDir, header), srcDir);
    for (const [name, entry] of Object.entries(symbols)) {
      if (typeof entry.value !== 'number') {
        continue;
      }
      if (entry.kind === 'flag') {
        flags[name] = entry.value;
      } else if (entry.kind === 'var') {
        vars[name] = entry.value;
      } else if (entry.kind === 'view') {
        views[name] = entry.value;
      } else if (entry.kind === 'object') {
        objects[name] = entry.value;
      } else if (entry.kind === 'define' && name.startsWith('rm.')) {
        roomNames[name] = entry.value;
      } else if (entry.kind === 'define') {
        defines[name] = entry.value;
      }
    }
  }

  return { flags, vars, views, objects, roomNames, defines };
}

function listRoomFiles(srcDir: string): { room: number; file: string }[] {
  const rooms = readdirSync(srcDir)
    .map((file) => ({ file, match: /^RM(\d+)\.CG$/i.exec(file) }))
    .filter((entry): entry is { file: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ room: parseInt(entry.match[1], 10), file: entry.file }));
  rooms.sort((a, b) => a.room - b.room);
  return rooms;
}

function isGlobalSymbol(global: GlobalSymbolTables, name: string, entry: SymbolEntry): boolean {
  const table =
    entry.kind === 'flag'
      ? global.flags
      : entry.kind === 'var'
        ? global.vars
        : entry.kind === 'view'
          ? global.views
          : entry.kind === 'object'
            ? global.objects
            : entry.kind === 'define'
              ? name.startsWith('rm.')
                ? global.roomNames
                : global.defines
              : undefined;
  return table !== undefined && table[name] === entry.value;
}

function compileRoom(
  srcDir: string,
  room: number,
  file: string,
  global: GlobalSymbolTables,
  roomNumberToName: Map<number, string>
): { artifact: RoomArtifact; messages: Record<number, string> } {
  const { source, symbols, messages } = preprocessFile(join(srcDir, file), srcDir);
  const { statements } = parseLogic(source);

  const localSymbols: Record<string, SymbolEntry> = {};
  for (const [name, entry] of Object.entries(symbols)) {
    if (!isGlobalSymbol(global, name, entry)) {
      localSymbols[name] = entry;
    }
  }

  return {
    artifact: { room, file, name: roomNumberToName.get(room), statements, localSymbols },
    messages,
  };
}

/** Compiles every SRC/RM*.CG in srcDir into a bundle, in memory, with no filesystem writes. */
export function compileAllLogic(srcDir: string = DEFAULT_SRC_DIR): CompileResult {
  const global = buildGlobalSymbolTables(srcDir);

  const roomNumberToName = new Map<number, string>();
  for (const [name, value] of Object.entries(global.roomNames)) {
    if (!roomNumberToName.has(value)) {
      roomNumberToName.set(value, name);
    }
  }

  const roomFiles = listRoomFiles(srcDir);
  const rooms: RoomArtifact[] = [];
  const messages: Record<number, Record<number, string>> = {};
  const failures: CompileFailure[] = [];

  for (const { room, file } of roomFiles) {
    try {
      const { artifact, messages: roomMessages } = compileRoom(srcDir, room, file, global, roomNumberToName);
      rooms.push(artifact);
      messages[room] = roomMessages;
    } catch (e) {
      failures.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    bundle: { rooms },
    symbols: global,
    messages,
    report: { totalFiles: roomFiles.length, succeeded: rooms.length, failures },
  };
}

function writeBundle(result: CompileResult): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'logic-bundle.json'), JSON.stringify(result.bundle, null, 2));
  writeFileSync(join(OUT_DIR, 'symbols.json'), JSON.stringify(result.symbols, null, 2));
  writeFileSync(join(OUT_DIR, 'messages.json'), JSON.stringify(result.messages, null, 2));
  writeFileSync(join(OUT_DIR, 'compile-report.json'), JSON.stringify(result.report, null, 2));
}

function main(): void {
  const result = compileAllLogic();
  writeBundle(result);

  const { symbols, report } = result;
  console.log(`compile-logic: ${report.succeeded}/${report.totalFiles} room logics compiled`);
  console.log(
    `  global symbols: ${Object.keys(symbols.flags).length} flags, ${Object.keys(symbols.vars).length} vars, ` +
      `${Object.keys(symbols.views).length} views, ${Object.keys(symbols.objects).length} objects, ` +
      `${Object.keys(symbols.roomNames).length} room names, ${Object.keys(symbols.defines).length} defines`
  );

  if (report.failures.length > 0) {
    console.error(`\ncompile-logic: ${report.failures.length} file(s) failed to compile:`);
    for (const failure of report.failures) {
      console.error(`  ${failure.file}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
