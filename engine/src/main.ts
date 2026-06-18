import { KeyboardInput } from './input/keyboard';
import { bindParserInputElement, ParserUi } from './input/parser-ui';
import { decodeWords } from './resources/words';
import { ReservedVar, VmState } from './vm/state';
import { InputParser } from './vm/tests';

const app = document.querySelector<HTMLDivElement>('#app');
const state = new VmState();

function buildShell(): { parserInput: HTMLInputElement; log: HTMLUListElement; debug: HTMLPreElement } | null {
  if (!app) {
    return null;
  }
  app.textContent = '';

  const title = document.createElement('h1');
  title.textContent = "King's Quest III";

  const parserInput = document.createElement('input');
  parserInput.type = 'text';
  parserInput.id = 'parser-input';
  parserInput.placeholder = 'What will you do?';
  parserInput.autocomplete = 'off';

  const log = document.createElement('ul');
  log.id = 'parser-log';

  const debug = document.createElement('pre');
  debug.id = 'debug-output';

  app.append(title, parserInput, log, debug);
  return { parserInput, log, debug };
}

function renderDebug(debug: HTMLPreElement): void {
  debug.textContent = `ego.dir = ${state.getVar(ReservedVar.EgoDirection)}\ninput enabled = ${state.isInputEnabled()}`;
}

async function setupInput(): Promise<void> {
  const shell = buildShell();
  if (!shell) {
    return;
  }
  const { parserInput, log, debug } = shell;
  renderDebug(debug);

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
    onMenu: () => console.info('Menu key pressed (menu UI not implemented yet).'),
  });

  window.addEventListener('keydown', (event) => {
    if (event.target === parserInput) {
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
