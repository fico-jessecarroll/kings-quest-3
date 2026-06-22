import { describe, expect, it } from 'vitest';
import { buildSymbolTable, type GlobalSymbols } from '../../src/vm/symbols';

function emptyGlobals(overrides: Partial<GlobalSymbols> = {}): GlobalSymbols {
  return { flags: {}, vars: {}, views: {}, objects: {}, defines: {}, ...overrides };
}

describe('buildSymbolTable', () => {
  it('flattens each global table into a SymbolEntry tagged with its kind', () => {
    const globals = emptyGlobals({
      flags: { onWater: 5 },
      vars: { 'ego.dir': 3 },
      views: { egoView: 0 },
      objects: { key: 7 },
      defines: { TANDY: 2 },
    });

    const table = buildSymbolTable(globals);

    expect(table.onWater).toEqual({ kind: 'flag', value: 5 });
    expect(table['ego.dir']).toEqual({ kind: 'var', value: 3 });
    expect(table.egoView).toEqual({ kind: 'view', value: 0 });
    expect(table.key).toEqual({ kind: 'object', value: 7 });
    expect(table.TANDY).toEqual({ kind: 'define', value: 2 });
  });

  it('merges local symbol tables on top of the globals, later tables winning', () => {
    const globals = emptyGlobals({ vars: { 'snore.timer': 230 } });
    const logic0Locals = { 'snore.timer': { kind: 'define' as const, value: 230 } };
    const roomLocals = { 'snore.timer': { kind: 'var' as const, value: 99 } };

    const table = buildSymbolTable(globals, logic0Locals, roomLocals);

    expect(table['snore.timer']).toEqual({ kind: 'var', value: 99 });
  });

  it('accepts any number of local symbol tables, applied in argument order', () => {
    const table = buildSymbolTable(
      emptyGlobals(),
      { a: { kind: 'define', value: 1 } },
      { b: { kind: 'define', value: 2 } },
      { a: { kind: 'define', value: 3 } }
    );

    expect(table.a).toEqual({ kind: 'define', value: 3 });
    expect(table.b).toEqual({ kind: 'define', value: 2 });
  });

  it('returns an empty table when there are no globals or locals', () => {
    expect(buildSymbolTable(emptyGlobals())).toEqual({});
  });

  it('does not mutate the local symbol tables passed in', () => {
    const roomLocals = { a: { kind: 'define' as const, value: 1 } };
    const table = buildSymbolTable(emptyGlobals(), roomLocals);
    table.a = { kind: 'define', value: 999 };
    expect(roomLocals.a).toEqual({ kind: 'define', value: 1 });
  });
});
