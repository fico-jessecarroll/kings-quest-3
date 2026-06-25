/**
 * The real game shell: loads every resource the game needs (A1,
 * game/resources.ts), assembles them into a live Interpreter via the A2
 * conductor core (game/engine.ts's `createEngine`) - the same wiring the
 * headless `discover-gaps` harness and the integration test suite build on
 * - then drives it with the A4 fixed-step game loop (game/loop.ts). Live
 * input - keyboard, the text parser, and the menu bar, all under
 * src/input/* - is wired onto the engine's shared `VmState` exactly as the
 * earlier inline-wiring version of this file did, just without re-deriving
 * the Interpreter/command/symbol-table assembly `createEngine` already owns.
 */

import { KeyboardInput } from './input/keyboard';
import { MenuUi } from './input/menu-ui';
import { bindParserInputElement, ParserUi } from './input/parser-ui';
import { decodeObjectFile, type AgiObject } from './resources/object';
import { applyEgoDirectionFromInput, createEngine } from './game/engine';
import { loadGameResources } from './game/resources';
import { createGameLoop } from './game/loop';
import { renderFrame } from './render/frame';
import { sizeScreenCanvas } from './render/screen';
import { SoundController } from './vm/soundController';
import { ReservedVar, type VmState } from './vm/state';

const MAX_SOUND_NUMBER = 255;

async function fetchSounds(): Promise<Map<number, Uint8Array>> {
  const ids = Array.from({ length: MAX_SOUND_NUMBER + 1 }, (_, i) => i);
  const results = await Promise.all(
    ids.map(async (id): Promise<[number, Uint8Array] | null> => {
      const res = await fetch(`/SND/SND.${id}`);
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
  // fetched and decoded up front rather than on demand. Sound is fetched
  // separately from loadGameResources(), which is scoped to A1's bundle/
  // OBJECT/WORDS/PICTURE set - see game/resources.ts.
  const [resources, soundBytes] = await Promise.all([loadGameResources(), fetchSounds()]);
  const staticObjectTable = decodeObjectFile(resources.objectBytes);

  const audioContext = new AudioContext();
  // SoundController needs the engine's VmState, but the engine's new.room
  // housekeeping needs SoundController's stop() before SoundController can
  // be built - this closure breaks that cycle by deferring the lookup until
  // a room transition actually happens, by which point soundController has
  // been assigned below.
  let soundController: SoundController;
  const engine = createEngine(resources, { stopSound: () => soundController.stop() });
  soundController = new SoundController({
    state: engine.state,
    audioContext,
    soundLoader: (id) => soundBytes.get(id),
  });
  for (const [name, impl] of Object.entries(soundController.commands)) {
    engine.interpreter.registerCommand(name, impl);
  }

  const menuUi = new MenuUi({
    state: engine.state,
    resolveMessage: engine.resolveMessage,
    onChange: () => renderMenuBar(menuUi, menuBar),
  });
  renderMenuBar(menuUi, menuBar);

  const parserUi = new ParserUi({
    state: engine.state,
    parser: engine.parser,
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
    state: engine.state,
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
    renderFrame(ctx, engine.state, {
      loadPictureResource: (n) => resources.pictures.get(n),
      spriteObjectNumbers: engine.objectTable.getAnimatedObjectNumbers(),
      resolveMessage: engine.resolveMessage,
      objects: staticObjectTable.objects as readonly AgiObject[],
      horizon: engine.objectTable.getHorizon(),
    });
    if (menuUi.isOpen()) {
      renderMenuBar(menuUi, menuBar);
    }
  }

  let cycles = 0;
  const loop = createGameLoop({
    state: engine.state,
    runCycle: () => {
      applyEgoDirectionFromInput(engine.state, engine.objectTable);
      engine.interpreter.runCycle();
      cycles++;
    },
    updateObjects: () => engine.objectTable.update(),
    render: () => {
      render();
      renderDebug(debug, engine.state, cycles);
    },
  });

  render();
  renderDebug(debug, engine.state, cycles);
  loop.start();
}

void main();
