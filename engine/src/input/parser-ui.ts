/**
 * The player's text-entry line: on submit, tokenizes the typed text against
 * the WORDS vocabulary and feeds it to the VM as said() input via
 * `InputParser.acceptInput` (src/vm/tests.ts). Submission is gated by the
 * same accept.input/prevent.input state (`VmState.isInputEnabled()`) that
 * gates keyboard movement in src/input/keyboard.ts - a line typed while
 * prevent.input is active is dropped rather than queued, matching AGI's own
 * behavior of simply not showing/accepting the prompt during prevent.input.
 */

import type { InputParser } from '../vm/tests';
import type { VmState } from '../vm/state';

export interface ParserUiOptions {
  state: VmState;
  parser: InputParser;
  /** Notified with the raw text after it's been tokenized and recorded for said(). */
  onSubmit?: (input: string) => void;
}

export class ParserUi {
  private readonly state: VmState;
  private readonly parser: InputParser;
  private readonly onSubmit?: (input: string) => void;

  constructor(options: ParserUiOptions) {
    this.state = options.state;
    this.parser = options.parser;
    this.onSubmit = options.onSubmit;
  }

  /** Whether the entry line should currently accept submissions. */
  isAcceptingInput(): boolean {
    return this.state.isInputEnabled();
  }

  /** Tokenizes `input` via the WORDS vocabulary and records it for said(), unless prevent.input is active. */
  submit(input: string): void {
    if (!this.isAcceptingInput()) {
      return;
    }
    this.parser.acceptInput(this.state, input);
    this.onSubmit?.(input);
  }
}

/**
 * Wires a real `<input>` element's Enter key to {@link ParserUi.submit},
 * clearing the field on a successful submission and leaving whatever the
 * player typed in place if prevent.input rejected it. Empty/whitespace-only
 * lines are not submitted, matching AGI's own parser.
 */
export function bindParserInputElement(element: HTMLInputElement, parserUi: ParserUi): void {
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    const value = element.value.trim();
    if (!value) {
      return;
    }
    if (!parserUi.isAcceptingInput()) {
      return;
    }
    parserUi.submit(value);
    element.value = '';
  });
}
