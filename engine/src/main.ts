/**
 * The real game shell: boots the compiled logic bundle (run `npm run
 * build:logic` first - see tools/compile-logic.ts) into an Interpreter wired
 * to every VM/render subsystem this repo has built (state, animated objects,
 * picture/sprite rendering, sound, the text parser, the menu bar), then
 * drives it via the requestAnimationFrame-backed game loop (game/loop.ts),
 * which honors `set.speed`-style slowdown through ReservedVar.TimeDelay -
 * and renders one frame per cycle batch to a canvas.
 *
 * Earlier versions of this file only wired keyboard/menu/parser input
 * straight onto VmState with no Interpreter running at all (no logic ever
 * executed, so nothing they touched had any effect beyond the DOM debug
 * readout). This is the first version that actually plays the game.
 */

import { KeyboardInput } from './input/keyboard';
import { MenuUi } from './input/menu-ui';
import { bindParserInputElement, ParserUi } from './input/parser-ui';
import { decodeObjectFile, type AgiObject } from './resources/object';
import { decodeWords } from './resources/words';
import { createGameLoop } from './game/loop';
import { renderFrame } from './render/frame';
import { sizeScreenCanvas } from './render/screen';
import { createCommands, tests as baseTests } from './vm/commands';
import { createObjectCommands } from './vm/objectCommands';
import { EGO_OBJECT, ObjectTable } from './vm/objects';
import { Interpreter, type SymbolTable } from './vm/interpreter';
import { SoundController } from './vm/soundController';
import { ReservedVar, VmState } from './vm/state';
import { InputParser } from './vm/tests';
import type { GlobalSymbolTables, LogicBundle } from '../tools/compile-logic';

const MAX_RESOURCE_ID = 255;

async function fetchResourceRange(dir: string, max: number): Promise<Map<number, Uint8Array>> {
  const ids = Array.from({ length: max + 1 }, (_, i) => i);
  const results = await Promise.all(
    ids.map(async (id): Promise<[number, Uint8Array] | null> => {
      const res = await fetch(`/${dir}/${dir}.${id}`);
      if (!res.ok) return null;
      return [id, new Uint8Array(await res.arrayBuffer())];
    }),
  );
  return new Map(results.filter((r): r is [number, Uint8Array] => r !== null));
}

function buildShell(): {
  parserInput: HTMLInputElement;
  log: HTMLUListElement;
  debug: HTMLPreElement;
  menuBar: HTMLDivElement;
  canvas: HTMLCanvasElement;
} | null {
  const app = document.querySelector<HTMLDivElement>('#app');
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!app || !canvas) {
    return null;
  }
  app.textContent = '';
  sizeScreenCanvas(canvas);

  const title = document.createElement('h1');
  title.textContent = "King's Quest III";

  const menuBar = document.createElement('div');
  menuBar.id = 'menu-bar';

  const parserInput = document.createElement('input');
  parserInput.type = 'text';
  parserInput.id = 'parser-input';
  parserInput.placeholder = 'What will you do?';
  parserInput.autocomplete = 'off';

  const log = document.createElement('ul');
  log.id = 'parser-log';

  const debug = document.createElement('pre');
  debug.id = 'debug-output';

  app.append(title, menuBar, canvas, parserInput, log, debug);
  return { parserInput, log, debug, menuBar, canvas };
}

/** Renders the menu bar's titles as plain text, plus the open menu's item list if expanded - a DOM stand-in for AGI's bar/dropdown since this shell draws the picture/sprites on canvas but hasn't moved the menu chrome there too. */
function renderMenuBar(menuUi: MenuUi, menuBar: HTMLDivElement): void {
  const menus = menuUi.getMenus();
  if (menus.length === 0) {
    menuBar.replaceChildren();
    return;
  }

  const titleRow = document.createElement('div');
  titleRow.textContent = menus
    .map((menu, index) => (menuUi.isOpen() && index === menuUi.getMenuIndex() ? `[${menu.label}]` : menu.label))
    .join('  ');
  menuBar.replaceChildren(titleRow);

  if (!menuUi.isOpen()) {
    return;
  }
  const activeMenu = menus[menuUi.getMenuIndex()];
  const dropdown = document.createElement('ul');
  activeMenu.items.forEach((item, index) => {
    const li = document.createElement('li');
    li.textContent = index === menuUi.getItemIndex() ? `> ${item.label}` : item.label;
    li.style.opacity = item.enabled ? '1' : '0.5';
    dropdown.append(li);
  });
  menuBar.append(dropdown);
}

function renderDebug(debug: HTMLPreElement, state: VmState, cycles: number): void {
  debug.textContent =
    `room = ${state.getCurrentRoom()}\n` +
    `ego.dir = ${state.getVar(ReservedVar.EgoDirection)}\n` +
    `input enabled = ${state.isInputEnabled()}\n` +
    `cycles run = ${cycles}`;
}

async function main(): Promise<void> {
  const shell = buildShell();
  if (!shell) {
    return;
  }
  const { parserInput, log, debug, menuBar, canvas } = shell;
  const ctx = canvas.getContext('2d');

  // The Interpreter's command implementations (load.pic/draw.pic, sound,
  // etc.) are all synchronous, so every resource they might touch is
  // fetched and decoded up front rather than on demand.
  const [wordsBytes, objectBytes, picBytes, soundBytes, bundleModule, symbolsModule, messagesModule] = await Promise.all([
    fetch('/WORDS.TOK').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    fetch('/OBJECT').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    fetchResourceRange('PIC', MAX_RESOURCE_ID),
    fetchResourceRange('SND', MAX_RESOURCE_ID),
    import('./generated/logic-bundle.json'),
    import('./generated/symbols.json'),
    import('./generated/messages.json'),
  ]);
  const bundle = bundleModule.default as unknown as LogicBundle;
  const symbols = symbolsModule.default as unknown as GlobalSymbolTables;
  const messages = messagesModule.default as unknown as Record<string, Record<string, string>>;

  const vocabulary = decodeWords(wordsBytes);
  const objectTable = decodeObjectFile(objectBytes);
  const roomsByNumber = new Map(bundle.rooms.map((r) => [r.room, r]));
  const logic0 = roomsByNumber.get(0);
  if (!logic0) {
    debug.textContent = 'logic 0 missing from the compiled bundle - run `npm run build:logic`.';
    return;
  }

  const state = new VmState();
  const objects = new ObjectTable({ state });
  const audioContext = new AudioContext();
  const soundController = new SoundController({
    state,
    audioContext,
    soundLoader: (id) => soundBytes.get(id),
  });

  // Resolves a %message number against whichever logic most recently set
  // up the active room (its own table), falling back to logic 0's - the
  // best approximation available without per-call "which logic is this"
  // context (CommandContext doesn't carry it; see commands.ts).
  function resolveMessage(messageNumber: number): string | undefined {
    return messages[String(state.getCurrentRoom())]?.[String(messageNumber)] ?? messages['0']?.[String(messageNumber)];
  }

  const commands = createCommands({
    loadPictureResource: (n) => picBytes.get(n),
    getMessage: resolveMessage,
  });
  const { commands: objCommands, tests: objTests } = createObjectCommands(objects);
  const parser = new InputParser(vocabulary);

  const symbolTable: SymbolTable = {};
  for (const [name, value] of Object.entries(symbols.flags)) symbolTable[name] = { kind: 'flag', value };
  for (const [name, value] of Object.entries(symbols.vars)) symbolTable[name] = { kind: 'var', value };
  for (const [name, value] of Object.entries(symbols.views)) symbolTable[name] = { kind: 'view', value };
  for (const [name, value] of Object.entries(symbols.objects)) symbolTable[name] = { kind: 'object', value };
  Object.assign(symbolTable, logic0.localSymbols);

  const interpreter = new Interpreter({
    state,
    symbols: symbolTable,
    logics: new Map([[0, { statements: logic0.statements }]]),
    commands: { ...commands, ...objCommands, ...soundController.commands },
    tests: { ...baseTests, ...objTests, said: parser.said },
    logicLoader: (n) => {
      const artifact = roomsByNumber.get(n);
      if (!artifact) return undefined;
      Object.assign(symbolTable, artifact.localSymbols);
      return { statements: artifact.statements };
    },
    logger: (message) => console.warn(message),
  });

  const menuUi = new MenuUi({ state, resolveMessage, onChange: () => renderMenuBar(menuUi, menuBar) });
  renderMenuBar(menuUi, menuBar);

  const parserUi = new ParserUi({
    state,
    parser,
    onSubmit: (input) => {
      const entry = document.createElement('li');
      entry.textContent = input;
      log.append(entry);
    },
  });
  bindParserInputElement(parserInput, parserUi);
  parserInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      parserInput.value = '';
    }
  });

  const keyboard = new KeyboardInput({
    state,
    onEnter: () => parserInput.focus(),
    onEscape: () => parserInput.blur(),
    onMenu: () => menuUi.toggle(),
  });

  const MENU_NAV_KEYS: Record<string, () => void> = {
    ArrowLeft: () => menuUi.moveMenu(-1),
    ArrowRight: () => menuUi.moveMenu(1),
    ArrowUp: () => menuUi.moveItem(-1),
    ArrowDown: () => menuUi.moveItem(1),
    Enter: () => menuUi.selectCurrent(),
    Escape: () => menuUi.close(),
  };

  window.addEventListener('keydown', (event) => {
    if (event.target === parserInput) {
      return;
    }
    if (menuUi.isOpen() && event.key in MENU_NAV_KEYS) {
      MENU_NAV_KEYS[event.key]();
      return;
    }
    keyboard.handleKeyDown(event.key);
  });
  window.addEventListener('keyup', (event) => {
    if (event.target === parserInput) {
      return;
    }
    keyboard.handleKeyUp(event.key);
  });

  function render(): void {
    if (!ctx) return;
    renderFrame(ctx, state, {
      loadPictureResource: (n) => picBytes.get(n),
      spriteObjectNumbers: objects.getAnimatedObjectNumbers(),
      resolveMessage,
      objects: objectTable.objects as readonly AgiObject[],
      horizon: objects.getHorizon(),
    });
    if (menuUi.isOpen()) {
      renderMenuBar(menuUi, menuBar);
    }
  }

  let cycles = 0;
  const loop = createGameLoop({
    state,
    runCycle: () => {
      // Ego's motion is driven by var 6 (ego.dir), which src/input/keyboard.ts
      // keeps in sync with whichever arrow keys are held - real AGI's
      // interpreter reads the keyboard/joystick into that var directly and
      // applies it to ego's "normal" motion every cycle the same way. Once a
      // script takes programmatic control of ego (move.obj/follow.ego/wander
      // - anything other than 'normal' motion), the keyboard is ignored until
      // that finishes.
      if (objects.getObject(EGO_OBJECT).motion === 'normal') {
        objects.setDirection(EGO_OBJECT, state.getVar(ReservedVar.EgoDirection));
      }
      interpreter.runCycle();
      cycles++;
    },
    updateObjects: () => objects.update(),
    render: () => {
      render();
      renderDebug(debug, state, cycles);
    },
  });

  render();
  renderDebug(debug, state, cycles);
  loop.start();
}

void main();
