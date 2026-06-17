/**
 * said() parser matching: tokenizes player input into AGI word-group
 * numbers using the WORDS.TOK vocabulary, then matches said() patterns
 * against that tokenized input. Confirmed against this game's real
 * WORDS.TOK: group 0 holds noise words ("the", "at", ...) dropped during
 * tokenization, group 1 holds "anyword" (matches exactly one word), and
 * group 9999 holds "rol" (rest-of-line - matches everything remaining).
 */

import type { DecodedWords } from '../resources/words';
import type { CommandContext, TestImpl } from './interpreter';
import { ReservedFlag, ReservedVar, VmState } from './state';

export const IGNORE_GROUP = 0;
export const ANYWORD_GROUP = 1;
export const REST_OF_LINE_GROUP = 9999;

export interface ParsedInput {
  /** Word-group numbers for the input, in order, with ignore-group words dropped. */
  groups: number[];
  /** 1-based position of the first word not found in the vocabulary, or 0 if every word was recognized. */
  unknownWordNumber: number;
}

function splitWords(input: string): string[] {
  return input.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Tokenizes raw player input into word-group numbers: case-insensitive, whitespace-separated, dropping ignore-group (noise) words. Stops at the first word not found in the vocabulary, as AGI's own parser does. */
export function tokenizeInput(input: string, vocabulary: DecodedWords): ParsedInput {
  const words = splitWords(input);
  const groups: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const group = vocabulary.words.get(words[i]);
    if (group === undefined) {
      return { groups, unknownWordNumber: i + 1 };
    }
    if (group !== IGNORE_GROUP) {
      groups.push(group);
    }
  }
  return { groups, unknownWordNumber: 0 };
}

/** Resolves a said() pattern word as written in CG source (e.g. "get$out" for the two-word dictionary entry "get out") to its vocabulary word-group, or undefined if it's not a recognized word. */
function resolvePatternGroup(word: string, vocabulary: DecodedWords): number | undefined {
  return vocabulary.words.get(word.toLowerCase().replace(/\$/g, ' '));
}

/** True if `pattern` (word-groups, as written in a said() call) matches `groups` (the tokenized input) end-to-end - positionally, except where the anyword/rol wildcards apply. */
export function matchSaid(pattern: number[], groups: number[]): boolean {
  let pos = 0;
  for (const group of pattern) {
    if (group === REST_OF_LINE_GROUP) {
      return true;
    }
    if (group === ANYWORD_GROUP) {
      if (pos >= groups.length) {
        return false;
      }
      pos++;
      continue;
    }
    if (groups[pos] !== group) {
      return false;
    }
    pos++;
  }
  return pos === groups.length;
}

/**
 * Tokenizes player input against a WORDS.TOK vocabulary and exposes the
 * said() test-function that matches against the most recently accepted
 * input. One instance is shared for the lifetime of a game session, since
 * said() always needs to see the latest line the player typed.
 */
export class InputParser {
  private groups: number[] = [];

  constructor(private readonly vocabulary: DecodedWords) {}

  /** Tokenizes `input`, records it for said() to match against, and sets the reserved unknown-word var and have-input flag. */
  acceptInput(state: VmState, input: string): void {
    const parsed = tokenizeInput(input, this.vocabulary);
    this.groups = parsed.groups;
    state.setVar(ReservedVar.UnknownWordNumber, parsed.unknownWordNumber);
    state.setFlag(ReservedFlag.HaveInput, true);
  }

  /** said() test-function implementation. Always false when the last input had an unrecognized word, since there's then nothing valid for any pattern to match. */
  said: TestImpl = (ctx: CommandContext) => {
    if (ctx.state.getVar(ReservedVar.UnknownWordNumber) !== 0) {
      return false;
    }
    const pattern = ctx.args.map((arg) => resolvePatternGroup(String(arg), this.vocabulary) ?? Number.NaN);
    return matchSaid(pattern, this.groups);
  };
}
