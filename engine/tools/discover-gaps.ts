// Boots every compiled room logic in isolation against a fresh VmState, runs
// a few interpreter cycles, and reports which rooms throw plus which
// commands/tests/logics this engine doesn't implement yet. This is the gap
// report behind the all-rooms integration pass: it's how "all ~108 rooms
// load and run their entry logic without errors" gets verified empirically
// instead of by spot-checking a handful of rooms by hand. Run via
// `npm run discover-gaps`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAllLogic, DEFAULT_SRC_DIR, type CompileResult, type RoomArtifact } from './compile-logic';
import { Interpreter, type SymbolTable } from '../src/vm/interpreter';
import { buildSymbolTable } from '../src/vm/symbols';
import { VmState } from '../src/vm/state';
import { ObjectTable } from '../src/vm/objects';
import { createCommands, tests as baseTests } from '../src/vm/commands';
import { createObjectCommands } from '../src/vm/objectCommands';
import { InputParser } from '../src/vm/tests';
import { decodeWords, type DecodedWords } from '../src/resources/words';
import type { Logic } from '../src/logic/ir';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PIC_DIR = join(REPO_ROOT, 'PIC');
export const CYCLES_PER_ROOM = 5;

function loadPictureResource(n: number): Uint8Array | undefined {
  try {
    return readFileSync(join(PIC_DIR, `PIC.${n}`));
  } catch {
    return undefined;
  }
}

/** Everything a per-room headless run needs that's shared across every room: the compiled bundle/symbol tables and the parser vocabulary. Computed once and reused, the same way `main()` always has. */
export interface DiscoverGapsFixture {
  result: CompileResult;
  roomsByNumber: Map<number, RoomArtifact>;
  logic0: RoomArtifact;
  vocabulary: DecodedWords;
}

export function loadDiscoverGapsFixture(srcDir: string = DEFAULT_SRC_DIR): DiscoverGapsFixture {
  const result = compileAllLogic(srcDir);
  const roomsByNumber = new Map(result.bundle.rooms.map((r) => [r.room, r]));
  const logic0 = roomsByNumber.get(0)!;
  const vocabulary = decodeWords(readFileSync(join(REPO_ROOT, 'WORDS.TOK')));
  return { result, roomsByNumber, logic0, vocabulary };
}

export interface RoomRunResult {
  room: number;
  thrown?: string;
  messages: string[];
  pictureDrawn: boolean;
}

/** Boots a single compiled room logic in isolation against a fresh VmState and runs it for `cycles` interpreter ticks - the same setup `main()` below loops over for every room. Exposed standalone so other callers (e.g. an all-rooms regression test) can reuse this exact harness without re-running the whole CLI. */
export function runRoomHeadless(fixture: DiscoverGapsFixture, room: RoomArtifact, cycles: number = CYCLES_PER_ROOM): RoomRunResult {
  const { roomsByNumber, logic0, result, vocabulary } = fixture;
  const messages: string[] = [];
  const state = new VmState();
  const objectTable = new ObjectTable({ state });
  const { commands: objCommands, tests: objTests } = createObjectCommands(objectTable, { logger: (m) => messages.push(m) });
  const commands = createCommands({ loadPictureResource, logger: (m) => messages.push(m) });
  const parser = new InputParser(vocabulary);

  const symTable: SymbolTable = buildSymbolTable(result.symbols, logic0.localSymbols, room.localSymbols);

  const logics = new Map<number, Logic>();
  logics.set(0, { statements: logic0.statements });
  logics.set(room.room, { statements: room.statements });

  const interpreter = new Interpreter({
    state,
    symbols: symTable,
    logics,
    commands: { ...commands, ...objCommands },
    tests: { ...baseTests, ...objTests, said: parser.said },
    logicLoader: (n) => {
      const artifact = roomsByNumber.get(n);
      if (!artifact) return undefined;
      Object.assign(symTable, artifact.localSymbols);
      return { statements: artifact.statements };
    },
    logger: (m) => messages.push(m),
  });

  state.setCurrentRoom(room.room);
  let thrown: string | undefined;
  try {
    for (let i = 0; i < cycles; i++) {
      interpreter.runCycle();
      objectTable.update();
    }
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }

  return { room: room.room, thrown, messages, pictureDrawn: state.getPictureBuffers() !== null };
}

function main(): void {
  const fixture = loadDiscoverGapsFixture();
  const { result } = fixture;

  const globalUnimplemented = new Map<string, Set<number>>();
  const thrown: { room: number; error: string }[] = [];
  let picDrawn = 0;

  for (const room of result.bundle.rooms) {
    process.stdout.write(`room ${room.room}...`);
    const outcome = runRoomHeadless(fixture, room);

    if (outcome.thrown) {
      thrown.push({ room: room.room, error: outcome.thrown });
      process.stdout.write(`threw\n`);
    } else {
      process.stdout.write(`ok\n`);
    }

    if (outcome.pictureDrawn) picDrawn++;

    for (const m of outcome.messages) {
      const key = m.split(':')[0] + ':' + (m.match(/unimplemented (command|test): ([^(]+)/)?.[2] ?? m);
      if (!globalUnimplemented.has(key)) globalUnimplemented.set(key, new Set());
      globalUnimplemented.get(key)!.add(room.room);
    }
  }

  console.log(`total rooms: ${result.bundle.rooms.length}`);
  console.log(`rooms with decoded picture buffers after boot: ${picDrawn}`);
  console.log(`thrown errors: ${thrown.length}`);
  for (const t of thrown.slice(0, 20)) console.log(`  room ${t.room}: ${t.error}`);
  console.log(`\nunique unimplemented-ish messages: ${globalUnimplemented.size}`);
  for (const [key, rooms] of [...globalUnimplemented.entries()].sort()) {
    console.log(`  ${key}  (rooms: ${[...rooms].slice(0, 5).join(',')}${rooms.size > 5 ? `... [${rooms.size}]` : ''})`);
  }

  if (thrown.length > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
