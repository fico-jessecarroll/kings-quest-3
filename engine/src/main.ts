import { KeyboardInput } from './input/keyboard';
import { MenuUi } from './input/menu-ui';
import { bindParserInputElement, ParserUi } from './input/parser-ui';
import { decodeWords } from './resources/words';
import { ReservedVar, VmState } from './vm/state';
import { InputParser } from './vm/tests';

const app = document.querySelector<HTMLDivElement>('#app');
const state = new VmState();

function buildShell(): {
  parserInput: HTMLInputElement;
  log: HTMLUListElement;
  debug: HTMLPreElement;
  menuBar: HTMLDivElement;
} | null {
  if (!app) {
    return null;
  }
  app.textContent = '';

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

  app.append(title, menuBar, parserInput, log, debug);
  return { parserInput, log, debug, menuBar };
}

/**
 * Renders the menu bar's titles as plain text, plus the open menu's item
 * list if expanded - a DOM stand-in for AGI's bar/dropdown since this shell
 * has no canvas yet (see drawMenuBar/drawMenuDropdown in render/text.ts for
 * the canvas version exercised in src/viewer.ts).
 */
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

function renderDebug(debug: HTMLPreElement): void {
  debug.textContent = `ego.dir = ${state.getVar(ReservedVar.EgoDirection)}\ninput enabled = ${state.isInputEnabled()}`;
}

async function setupInput(): Promise<void> {
  const shell = buildShell();
  if (!shell) {
    return;
  }
  const { parserInput, log, debug, menuBar } = shell;
  renderDebug(debug);

  // No Logic is loaded into this shell yet (see InputParser wiring below for
  // the only VM-adjacent piece that runs today), so there's no real %message
  // table to resolve menu/item labels against - falls back to "(message N)"
  // until a future story wires an Interpreter in here.
  const menuUi = new MenuUi({
    state,
    resolveMessage: () => undefined,
    onChange: () => renderMenuBar(menuUi, menuBar),
  });
  renderMenuBar(menuUi, menuBar);

  const wordsResponse = await fetch('/WORDS.TOK');
  if (!wordsResponse.ok) {
    console.error(`Failed to load WORDS.TOK: HTTP ${wordsResponse.status}`);
    return;
  }
  const vocabulary = decodeWords(new Uint8Array(await wordsResponse.arrayBuffer()));
  const parser = new InputParser(vocabulary);

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

  // Esc clears the in-progress line without submitting it (AGI's cancel.line),
  // handled directly on the field rather than via KeyboardInput below, which
  // is for keys typed outside the text entry line.
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

  // While the menu bar is open, arrow/Enter/Escape drive MenuUi instead of
  // ego movement/the parser - same precedence as real AGI, where the menu
  // captures input until closed.
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
    renderDebug(debug);
  });
  window.addEventListener('keyup', (event) => {
    if (event.target === parserInput) {
      return;
    }
    keyboard.handleKeyUp(event.key);
    renderDebug(debug);
  });
}

void setupInput();
