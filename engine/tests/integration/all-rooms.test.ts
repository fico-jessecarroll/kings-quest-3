// Regression oracle for the class of bug fixed in "Fix playthrough fidelity
// gaps" (directive dialect, init.log, indirect assign): a symbol that the
// compiler couldn't fully resolve (e.g. a "#define" alias the preprocessor
// silently dropped) doesn't throw at compile time - it surfaces only when
// the interpreter actually evaluates the statement that references it, as
// an `unresolved symbol: <name>` or `cannot resolve "<name>" as a flag or
// var` logged error. Booting every room headless and asserting none of
// those messages appear is the only way to catch a reintroduction of that
// bug across all 124 rooms at once, instead of one room at a time.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDiscoverGapsFixture, runRoomHeadless, type DiscoverGapsFixture } from '../../tools/discover-gaps';

const UNRESOLVED_SYMBOL_PATTERN = /unresolved symbol|cannot resolve ".*" as a (flag or var|var)/;

describe('all rooms boot headless without unresolved-symbol errors', () => {
  let fixture: DiscoverGapsFixture;

  beforeAll(() => {
    fixture = loadDiscoverGapsFixture();
  });

  it('compiles every room logic', () => {
    expect(fixture.result.report.failures).toEqual([]);
    expect(fixture.result.bundle.rooms.length).toBeGreaterThan(0);
  });

  it('produces zero unresolved-symbol/cannot-resolve statement errors across all rooms', () => {
    const offenders: { room: number; message: string }[] = [];

    for (const room of fixture.result.bundle.rooms) {
      const outcome = runRoomHeadless(fixture, room);
      for (const message of outcome.messages) {
        if (UNRESOLVED_SYMBOL_PATTERN.test(message)) {
          offenders.push({ room: room.room, message });
        }
      }
      if (outcome.thrown && UNRESOLVED_SYMBOL_PATTERN.test(outcome.thrown)) {
        offenders.push({ room: room.room, message: outcome.thrown });
      }
    }

    const summary = offenders.map((o) => `room ${o.room}: ${o.message}`).join('\n');
    expect(offenders, summary).toEqual([]);
  });
});
