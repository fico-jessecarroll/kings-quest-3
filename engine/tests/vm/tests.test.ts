import { beforeEach, describe, expect, it } from 'vitest';
import { decodeWords, type DecodedWords } from '../../src/resources/words';
import { ReservedFlag, ReservedVar, VmState } from '../../src/vm/state';
import { InputParser, matchSaid, tokenizeInput } from '../../src/vm/tests';
import { readWordsTok } from '../helpers/assets';

describe('tokenizeInput (real WORDS.TOK)', () => {
  let vocabulary: DecodedWords;

  beforeEach(() => {
    vocabulary = decodeWords(readWordsTok());
  });

  it('tokenizes recognized words to their word-group numbers', () => {
    expect(tokenizeInput('look telescope', vocabulary)).toEqual({ groups: [2, 32], unknownWordNumber: 0 });
  });

  it('drops ignore-group (noise) words like "the" and "at"', () => {
    expect(tokenizeInput('look at the telescope', vocabulary)).toEqual({ groups: [2, 32], unknownWordNumber: 0 });
  });

  it('reports the 1-based position of the first unrecognized word and stops there', () => {
    expect(tokenizeInput('look xyzzy telescope', vocabulary)).toEqual({ groups: [2], unknownWordNumber: 2 });
  });

  it('is case-insensitive', () => {
    expect(tokenizeInput('Look Telescope', vocabulary)).toEqual({ groups: [2, 32], unknownWordNumber: 0 });
  });
});

describe('matchSaid (real WORDS.TOK groups)', () => {
  let vocabulary: DecodedWords;
  const groupOf = (word: string) => vocabulary.words.get(word)!;

  beforeEach(() => {
    vocabulary = decodeWords(readWordsTok());
  });

  it('matches when the pattern equals the full tokenized input', () => {
    const groups = tokenizeInput('look telescope', vocabulary).groups;
    expect(matchSaid([groupOf('look'), groupOf('telescope')], groups)).toBe(true);
  });

  it('does not match a different word at the same position', () => {
    const groups = tokenizeInput('look telescope', vocabulary).groups;
    expect(matchSaid([groupOf('look'), groupOf('stairs')], groups)).toBe(false);
  });

  it('does not match a shorter pattern that leaves input words unconsumed', () => {
    const groups = tokenizeInput('look telescope', vocabulary).groups;
    expect(matchSaid([groupOf('look')], groups)).toBe(false);
  });

  it('"anyword" matches exactly one word in that position', () => {
    const ANYWORD = groupOf('anyword');
    expect(matchSaid([ANYWORD, groupOf('telescope')], tokenizeInput('look telescope', vocabulary).groups)).toBe(true);
    expect(matchSaid([groupOf('look'), ANYWORD], tokenizeInput('look mud', vocabulary).groups)).toBe(true);
    // anyword still requires a word to be present at that position.
    expect(matchSaid([groupOf('look'), ANYWORD], tokenizeInput('look', vocabulary).groups)).toBe(false);
  });

  it('"rol" (rest of line) matches everything remaining, including nothing', () => {
    const ROL = groupOf('rol');
    expect(matchSaid([groupOf('thanks'), ROL], tokenizeInput('thanks mountain trees', vocabulary).groups)).toBe(true);
    expect(matchSaid([groupOf('thanks'), ROL], tokenizeInput('thanks', vocabulary).groups)).toBe(true);
    // without rol, trailing words that aren't consumed by the pattern fail the match.
    expect(matchSaid([groupOf('thanks')], tokenizeInput('thanks mountain trees', vocabulary).groups)).toBe(false);
  });
});

describe('InputParser.said (wired through a real Interpreter-style ctx)', () => {
  let vocabulary: DecodedWords;
  let parser: InputParser;
  let state: VmState;

  beforeEach(() => {
    vocabulary = decodeWords(readWordsTok());
    parser = new InputParser(vocabulary);
    state = new VmState();
  });

  it('"look telescope" satisfies said(look, telescope) but not said(look, stairs)', () => {
    parser.acceptInput(state, 'look telescope');
    expect(parser.said({ state, args: ['look', 'telescope'] })).toBe(true);
    expect(parser.said({ state, args: ['look', 'stairs'] })).toBe(false);
  });

  it('resolves said() pattern words containing "$" to the matching multi-word dictionary entry', () => {
    parser.acceptInput(state, 'thanks');
    expect(parser.said({ state, args: ['thanks', 'rol'] })).toBe(true);
  });

  it('fails to match when the input contained an unrecognized word', () => {
    parser.acceptInput(state, 'look xyzzy');
    expect(parser.said({ state, args: ['look', 'anyword'] })).toBe(false);
  });

  it('sets the have-input flag and the unknown-word var when accepting input', () => {
    parser.acceptInput(state, 'look telescope');
    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(true);
    expect(state.getVar(ReservedVar.UnknownWordNumber)).toBe(0);

    parser.acceptInput(state, 'look xyzzy');
    expect(state.getFlag(ReservedFlag.HaveInput)).toBe(true);
    expect(state.getVar(ReservedVar.UnknownWordNumber)).toBe(2);
  });
});
