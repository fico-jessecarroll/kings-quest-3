import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindParserInputElement, ParserUi } from '../../src/input/parser-ui';
import { decodeWords, type DecodedWords } from '../../src/resources/words';
import { ReservedFlag, ReservedVar, VmState } from '../../src/vm/state';
import { InputParser } from '../../src/vm/tests';
import { readWordsTok } from '../helpers/assets';

describe('ParserUi', () => {
  let vocabulary: DecodedWords;
  let state: VmState;
  let parser: InputParser;

  beforeEach(() => {
    vocabulary = decodeWords(readWordsTok());
    state = new VmState();
    parser = new InputParser(vocabulary);
  });

  it('tokenizes submitted text via WORDS and makes it available to said()', () => {
    const ui = new ParserUi({ state, parser });

    ui.submit('look telescope');

    expect(parser.said({ state, args: ['look', 'telescope'] })).toBe(true);
    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(true);
    expect(state.getVar(ReservedVar.UnknownWordNumber)).toBe(0);
  });

  it('notifies onSubmit with the raw text after tokenizing', () => {
    const onSubmit = vi.fn();
    const ui = new ParserUi({ state, parser, onSubmit });

    ui.submit('look telescope');

    expect(onSubmit).toHaveBeenCalledWith('look telescope');
  });

  it('records the unknown-word position for unrecognized input', () => {
    const ui = new ParserUi({ state, parser });

    ui.submit('look xyzzy');

    expect(state.getVar(ReservedVar.UnknownWordNumber)).toBe(2);
  });

  describe('accept.input/prevent.input gating', () => {
    it('isAcceptingInput reflects VmState.isInputEnabled', () => {
      const ui = new ParserUi({ state, parser });
      expect(ui.isAcceptingInput()).toBe(true);

      state.setInputEnabled(false);
      expect(ui.isAcceptingInput()).toBe(false);
    });

    it('drops a submission while prevent.input is active: no tokenizing, no onSubmit', () => {
      const onSubmit = vi.fn();
      const ui = new ParserUi({ state, parser, onSubmit });
      state.setInputEnabled(false);

      ui.submit('look telescope');

      expect(onSubmit).not.toHaveBeenCalled();
      expect(state.getFlag(ReservedFlag.HaveInput)).toBe(false);
    });
  });
});

describe('bindParserInputElement', () => {
  let vocabulary: DecodedWords;
  let state: VmState;
  let parser: InputParser;
  let ui: ParserUi;

  // Minimal fake of the slice of HTMLInputElement this binding touches -
  // same pattern as the FakeAudioContext in soundController.test.ts.
  class FakeInputElement {
    value = '';
    private handlers: Array<(event: { key: string }) => void> = [];
    addEventListener(type: string, handler: (event: { key: string }) => void): void {
      if (type === 'keydown') this.handlers.push(handler);
    }
    pressKey(key: string): void {
      for (const handler of this.handlers) handler({ key });
    }
  }

  beforeEach(() => {
    vocabulary = decodeWords(readWordsTok());
    state = new VmState();
    parser = new InputParser(vocabulary);
    ui = new ParserUi({ state, parser });
  });

  it('submits the trimmed field value on Enter and clears it', () => {
    const element = new FakeInputElement();
    bindParserInputElement(element as unknown as HTMLInputElement, ui);
    element.value = '  look telescope  ';

    element.pressKey('Enter');

    expect(parser.said({ state, args: ['look', 'telescope'] })).toBe(true);
    expect(element.value).toBe('');
  });

  it('ignores keys other than Enter', () => {
    const element = new FakeInputElement();
    bindParserInputElement(element as unknown as HTMLInputElement, ui);
    element.value = 'look telescope';

    element.pressKey('a');

    expect(element.value).toBe('look telescope');
    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(false);
  });

  it('does not submit an empty or whitespace-only line', () => {
    const element = new FakeInputElement();
    bindParserInputElement(element as unknown as HTMLInputElement, ui);
    element.value = '   ';

    element.pressKey('Enter');

    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(false);
  });

  it('leaves the typed text in place when prevent.input rejects the submission', () => {
    const element = new FakeInputElement();
    bindParserInputElement(element as unknown as HTMLInputElement, ui);
    state.setInputEnabled(false);
    element.value = 'look telescope';

    element.pressKey('Enter');

    expect(element.value).toBe('look telescope');
    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(false);
  });
});
