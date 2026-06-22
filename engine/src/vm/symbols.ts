import type { SymbolEntry } from '../logic/preprocess';

export type SymbolTable = Record<string, SymbolEntry>;

/**
 * Structural shape of compile-logic.ts's GlobalSymbolTables (and the
 * generated symbols.json it serializes): one numeric lookup table per
 * symbol kind, keyed by name. Declared independently here rather than
 * imported, so this module stays usable from src/ (e.g. the conductor in
 * A2, which loads this same shape straight out of symbols.json) without
 * src/ reaching back into tools/.
 */
export interface GlobalSymbols {
  flags: Record<string, number>;
  vars: Record<string, number>;
  views: Record<string, number>;
  objects: Record<string, number>;
  defines: Record<string, number>;
}

/**
 * Flattens the global symbol tables into one SymbolTable, then merges any
 * number of local symbol tables on top, in argument order - later tables
 * win on name collisions. This is the shared "globals + per-room locals"
 * resolution path used by discover-gaps.ts's headless room runner and (per
 * the B2 story) the future conductor, so both resolve symbols identically.
 */
export function buildSymbolTable(globals: GlobalSymbols, ...localSymbols: Record<string, SymbolEntry>[]): SymbolTable {
  const table: SymbolTable = {};
  for (const [name, value] of Object.entries(globals.flags)) table[name] = { kind: 'flag', value };
  for (const [name, value] of Object.entries(globals.vars)) table[name] = { kind: 'var', value };
  for (const [name, value] of Object.entries(globals.views)) table[name] = { kind: 'view', value };
  for (const [name, value] of Object.entries(globals.objects)) table[name] = { kind: 'object', value };
  for (const [name, value] of Object.entries(globals.defines)) table[name] = { kind: 'define', value };
  for (const locals of localSymbols) {
    Object.assign(table, locals);
  }
  return table;
}
