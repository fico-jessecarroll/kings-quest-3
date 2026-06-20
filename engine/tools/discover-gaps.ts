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
import { compileAllLogic, DEFAULT_SRC_DIR } from './compile-logic';
import { Interpreter, type SymbolTable } from '../src/vm/interpreter';
import { VmState } from '../src/vm/state';
import { ObjectTable } from '../src/vm/objects';
import { createCommands, tests as baseTests } from '../src/vm/commands';
import { createObjectCommands } from '../src/vm/objectCommands';
import { InputParser } from '../src/vm/tests';
import { decodeWords } from '../src/resources/words';
import type { Logic } from '../src/logic/ir';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PIC_DIR = join(REPO_ROOT, 'PIC');
const CYCLES_PER_ROOM = 5;

function loadPictureResource(n: number): Uint8Array | undefined {
  try {
    return readFileSync(join(PIC_DIR, `PIC.${n}`));
  } catch {
    return undefined;
  }
}

function main(): void {
  const result = compileAllLogic(DEFAULT_SRC_DIR);
  const roomsByNumber = new Map(result.bundle.rooms.map((r) => [r.room, r]));
  const logic0 = roomsByNumber.get(0)!;
  const vocabulary = decodeWords(readFileSync(join(REPO_ROOT, 'WORDS.TOK')));

  const globalUnimplemented = new Map<string, Set<number>>();
  const thrown: { room: number; error: string }[] = [];
  let picDrawn = 0;

  for (const room of result.bundle.rooms) {
    const messages: string[] = [];
    const state = new VmState();
    const objectTable = new ObjectTable({ state });
    const { commands: objCommands, tests: objTests } = createObjectCommands(objectTable, { logger: (m) => messages.push(m) });
    const commands = createCommands({ loadPictureResource, logger: (m) => messages.push(m) });
    const parser = new InputParser(vocabulary);

    const symTable: SymbolTable = {};
    for (const [name, value] of Object.entries(result.symbols.flags)) symTable[name] = { kind: 'flag', value };
    for (const [name, value] of Object.entries(result.symbols.vars)) symTable[name] = { kind: 'var', value };
    for (const [name, value] of Object.entries(result.symbols.views)) symTable[name] = { kind: 'view', value };
    for (const [name, value] of Object.entries(result.symbols.objects)) symTable[name] = { kind: 'object', value };
    Object.assign(symTable, logic0.localSymbols, room.localSymbols);

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
    process.stdout.write(`room ${room.room}...`);
    try {
      for (let i = 0; i < CYCLES_PER_ROOM; i++) {
        interpreter.runCycle();
        objectTable.update();
      }
      process.stdout.write(`ok\n`);
    } catch (e) {
      thrown.push({ room: room.room, error: e instanceof Error ? e.message : String(e) });
      process.stdout.write(`threw\n`);
    }

    if (state.getPictureBuffers()) picDrawn++;

    for (const m of messages) {
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
