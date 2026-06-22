/**
 * The conductor core: assembles a {@link GameResources} bundle (A1) into a
 * live {@link Interpreter}, wiring it to the same command/test/object set as
 * the discover-gaps headless harness (`tools/discover-gaps.ts:44-76`) and
 * `main.ts`'s inline shell - `VmState`, `ObjectTable`, `createCommands` +
 * `createObjectCommands`, the base test set + `parser.said`, and a
 * `logicLoader` that resolves room artifacts from the bundle and merges
 * their `localSymbols` via B2's {@link buildSymbolTable}. This is the one
 * reusable module both the live game shell and headless tests build on, so
 * room-transition (A3), the game loop (A4), and live input (A5) all drive
 * the same wiring instead of re-deriving it.
 */

import { Interpreter, type SymbolTable } from '../vm/interpreter';
import { buildSymbolTable } from '../vm/symbols';
import { ObjectTable } from '../vm/objects';
import { VmState } from '../vm/state';
import { createCommands, tests as baseTests } from '../vm/commands';
import { createObjectCommands } from '../vm/objectCommands';
import { InputParser } from '../vm/tests';
import { decodeWords } from '../resources/words';
import type { GameMessages, GameResources } from './resources';

export interface EngineOptions {
  /** Receives one line per first-seen problem (unimplemented command/test, missing resource). Defaults to console.warn. */
  logger?: (message: string) => void;
}

export interface Engine {
  state: VmState;
  objectTable: ObjectTable;
  parser: InputParser;
  interpreter: Interpreter;
  /** Resolves an AGI %message number against the current room's table, falling back to logic 0's. */
  resolveMessage: (messageNumber: number) => string | undefined;
}

/** Resolves a %message number against `room`'s own message table, falling back to logic 0's - the best approximation available without per-call "which logic is this" context (see commands.ts's `CommandContext`). */
export function resolveRoomMessage(messages: GameMessages, room: number, messageNumber: number): string | undefined {
  return messages[String(room)]?.[String(messageNumber)] ?? messages['0']?.[String(messageNumber)];
}

/**
 * Builds a fully-wired {@link Interpreter} (plus the state/object-table/
 * parser it shares) from a loaded {@link GameResources} bundle. Only logic 0
 * is preloaded; every other room is resolved on demand by the `logicLoader`,
 * matching `call()`'s real-AGI behavior of transparently loading a
 * non-resident logic (see interpreter.ts's `resolveLogic`).
 */
export function createEngine(resources: GameResources, options: EngineOptions = {}): Engine {
  const logger = options.logger ?? ((message: string) => console.warn(message));
  const roomsByNumber = new Map(resources.bundle.rooms.map((room) => [room.room, room]));
  const logic0 = roomsByNumber.get(0);
  if (!logic0) {
    throw new Error('logic 0 missing from the compiled bundle - run `npm run build:logic`.');
  }

  const state = new VmState();
  const objectTable = new ObjectTable({ state });
  const parser = new InputParser(decodeWords(resources.wordsBytes));

  const resolveMessage = (messageNumber: number): string | undefined =>
    resolveRoomMessage(resources.messages, state.getCurrentRoom(), messageNumber);

  const commands = createCommands({
    loadPictureResource: (n) => resources.pictures.get(n),
    getMessage: resolveMessage,
    logger,
  });
  const { commands: objCommands, tests: objTests } = createObjectCommands(objectTable, { logger });

  const symbolTable: SymbolTable = buildSymbolTable(resources.symbols, logic0.localSymbols);

  const interpreter = new Interpreter({
    state,
    symbols: symbolTable,
    logics: new Map([[0, { statements: logic0.statements }]]),
    commands: { ...commands, ...objCommands },
    tests: { ...baseTests, ...objTests, said: parser.said },
    logicLoader: (number) => {
      const artifact = roomsByNumber.get(number);
      if (!artifact) return undefined;
      Object.assign(symbolTable, artifact.localSymbols);
      return { statements: artifact.statements };
    },
    logger,
  });

  return { state, objectTable, parser, interpreter, resolveMessage };
}
