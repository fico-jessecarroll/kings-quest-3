/**
 * The AGI interpreter cycle: evaluates a {@link Logic}'s IR against a
 * {@link VmState}, dispatching commands and test-functions by name, and
 * driving each game tick (logic 0, then the current room's logic).
 *
 * The IR is a statement tree (if/else nest their branches), but `goto`/labels
 * can jump across that nesting - real AGI logics compile to flat bytecode
 * with absolute jump addresses, so before a {@link Logic} runs for the first
 * time it's flattened here into a linear list of {@link Op}s with resolved
 * jump targets, matching that model and giving goto/label well-defined
 * semantics regardless of how deeply the source nested its braces.
 */

import type { BoolExpr, CallNode, IncDecStatement, Literal, Logic, AssignStatement, Statement } from '../logic/ir';
import type { SymbolEntry } from '../logic/preprocess';
import { VmState } from './state';

export type CommandArgValue = number | string;

export interface CommandContext {
  state: VmState;
  args: CommandArgValue[];
}

export type CommandImpl = (ctx: CommandContext) => void;
export type TestImpl = (ctx: CommandContext) => boolean;

export type SymbolTable = Record<string, SymbolEntry>;

export interface InterpreterOptions {
  state: VmState;
  symbols?: SymbolTable;
  logics?: Map<number, Logic> | Record<number, Logic>;
  commands?: Record<string, CommandImpl>;
  tests?: Record<string, TestImpl>;
  /** Looks up/parses a not-yet-loaded logic by number for the `load.logics` command. */
  logicLoader?: (logicNumber: number) => Logic | undefined;
  /** Receives one line per first-seen unimplemented command/test or missing logic. Defaults to console.warn. */
  logger?: (message: string) => void;
}

type Op =
  | { kind: 'stmt'; stmt: CallNode | AssignStatement | IncDecStatement }
  | { kind: 'jumpIfFalse'; test: BoolExpr; target: number }
  | { kind: 'jump'; target: number }
  | { kind: 'return' };

function wrapByte(value: number): number {
  return ((value % 256) + 256) % 256;
}

/** Appends statements to `ops` in document order, recording label positions and goto targets to patch once the full list is known. */
function flatten(
  statements: Statement[],
  ops: Op[],
  labels: Map<string, number>,
  gotoPatches: { index: number; label: string }[]
): void {
  for (const stmt of statements) {
    switch (stmt.type) {
      case 'label':
        labels.set(stmt.name, ops.length);
        break;

      case 'goto':
        gotoPatches.push({ index: ops.length, label: stmt.label });
        ops.push({ kind: 'jump', target: -1 });
        break;

      case 'return':
        ops.push({ kind: 'return' });
        break;

      case 'if': {
        const jumpIfFalseIndex = ops.length;
        ops.push({ kind: 'jumpIfFalse', test: stmt.test, target: -1 });
        flatten(stmt.then, ops, labels, gotoPatches);

        let jumpOverElseIndex = -1;
        if (stmt.else) {
          jumpOverElseIndex = ops.length;
          ops.push({ kind: 'jump', target: -1 });
        }

        (ops[jumpIfFalseIndex] as { target: number }).target = ops.length;
        if (stmt.else) {
          flatten(stmt.else, ops, labels, gotoPatches);
          (ops[jumpOverElseIndex] as { target: number }).target = ops.length;
        }
        break;
      }

      default:
        ops.push({ kind: 'stmt', stmt });
    }
  }
}

function compile(statements: Statement[]): Op[] {
  const ops: Op[] = [];
  const labels = new Map<string, number>();
  const gotoPatches: { index: number; label: string }[] = [];
  flatten(statements, ops, labels, gotoPatches);

  for (const { index, label } of gotoPatches) {
    const target = labels.get(label);
    if (target === undefined) {
      throw new Error(`goto target label not found: ${label}`);
    }
    (ops[index] as { target: number }).target = target;
  }
  return ops;
}

export class Interpreter {
  private readonly state: VmState;
  private readonly symbols: SymbolTable;
  private readonly logics = new Map<number, Logic>();
  private readonly programs = new Map<Logic, Op[]>();
  private readonly commands = new Map<string, CommandImpl>();
  private readonly tests = new Map<string, TestImpl>();
  private readonly logicLoader?: (logicNumber: number) => Logic | undefined;
  private readonly logger: (message: string) => void;
  private readonly loggedOnce = new Set<string>();
  private roomChangeRequested = false;

  constructor(options: InterpreterOptions) {
    this.state = options.state;
    this.symbols = options.symbols ?? {};
    this.logicLoader = options.logicLoader;
    this.logger = options.logger ?? ((message) => console.warn(message));

    if (options.logics) {
      const entries = options.logics instanceof Map ? options.logics.entries() : Object.entries(options.logics).map(([k, v]) => [Number(k), v] as const);
      for (const [number, logic] of entries) {
        this.logics.set(number, logic);
      }
    }

    this.registerBuiltinCommands();
    for (const [name, impl] of Object.entries(options.commands ?? {})) {
      this.commands.set(name, impl);
    }
    for (const [name, impl] of Object.entries(options.tests ?? {})) {
      this.tests.set(name, impl);
    }
  }

  private registerBuiltinCommands(): void {
    this.commands.set('new.room', (ctx) => {
      const room = ctx.args[0];
      if (typeof room !== 'number') {
        this.logOnce('new.room:bad-arg', `new.room(): expected a numeric room, got ${String(room)}`);
        return;
      }
      this.state.setCurrentRoom(room);
      this.roomChangeRequested = true;
    });

    this.commands.set('call', (ctx) => {
      const logicNumber = ctx.args[0];
      if (typeof logicNumber !== 'number') {
        this.logOnce('call:bad-arg', `call(): expected a numeric logic number, got ${String(logicNumber)}`);
        return;
      }
      this.runLogic(logicNumber);
    });

    this.commands.set('load.logics', (ctx) => {
      const logicNumber = ctx.args[0];
      if (typeof logicNumber !== 'number' || this.logics.has(logicNumber)) {
        return;
      }
      const loaded = this.logicLoader?.(logicNumber);
      if (loaded) {
        this.logics.set(logicNumber, loaded);
      } else {
        this.logOnce(`load.logics:${logicNumber}`, `load.logics(${logicNumber}): no logic loader configured or logic not found`);
      }
    });
  }

  registerCommand(name: string, impl: CommandImpl): void {
    this.commands.set(name, impl);
  }

  registerTest(name: string, impl: TestImpl): void {
    this.tests.set(name, impl);
  }

  loadLogic(number: number, logic: Logic): void {
    this.logics.set(number, logic);
  }

  /** Runs one interpreter tick: logic 0, then the current room's logic - unless `new.room` fired during logic 0, in which case the room logic is deferred to the next tick. */
  runCycle(): void {
    this.roomChangeRequested = false;
    this.runLogic(0);
    if (this.roomChangeRequested) {
      return;
    }
    this.runLogic(this.state.getCurrentRoom());
  }

  runLogic(number: number): void {
    const logic = this.logics.get(number);
    if (!logic) {
      this.logOnce(`logic:${number}`, `logic ${number} is not loaded`);
      return;
    }
    this.runProgram(this.getProgram(logic));
  }

  private getProgram(logic: Logic): Op[] {
    let program = this.programs.get(logic);
    if (!program) {
      program = compile(logic.statements);
      this.programs.set(logic, program);
    }
    return program;
  }

  private runProgram(ops: Op[]): void {
    let pc = 0;
    while (pc < ops.length) {
      if (this.roomChangeRequested) {
        return;
      }
      const op = ops[pc];
      switch (op.kind) {
        case 'stmt':
          this.executeStatement(op.stmt);
          pc++;
          break;
        case 'jumpIfFalse':
          pc = this.evaluateBoolExpr(op.test) ? pc + 1 : op.target;
          break;
        case 'jump':
          pc = op.target;
          break;
        case 'return':
          return;
      }
    }
  }

  private executeStatement(stmt: CallNode | AssignStatement | IncDecStatement): void {
    switch (stmt.type) {
      case 'call':
        this.dispatchCommand(stmt.name, stmt.args.map((arg) => this.resolveArgValue(arg)));
        break;

      case 'assign': {
        const index = this.resolveVarIndex(stmt.target);
        const operand = this.resolveNumericOperand(stmt.value);
        const current = this.state.getVar(index);
        const next = stmt.op === '=' ? operand : stmt.op === '+=' ? current + operand : current - operand;
        this.state.setVar(index, wrapByte(next));
        break;
      }

      case 'incdec': {
        const index = this.resolveVarIndex(stmt.target);
        const current = this.state.getVar(index);
        this.state.setVar(index, wrapByte(stmt.op === '++' ? current + 1 : current - 1));
        break;
      }
    }
  }

  private dispatchCommand(name: string, args: CommandArgValue[]): void {
    const impl = this.commands.get(name);
    if (impl) {
      impl({ state: this.state, args });
      return;
    }
    this.logOnce(`cmd:${name}`, `[interpreter] unimplemented command: ${name}(${args.join(', ')})`);
  }

  private evaluateTestCall(node: CallNode): boolean {
    const args = node.args.map((arg) => this.resolveArgValue(arg));
    const impl = this.tests.get(node.name);
    if (impl) {
      return impl({ state: this.state, args });
    }
    this.logOnce(`test:${node.name}`, `[interpreter] unimplemented test: ${node.name}(${args.join(', ')})`);
    return false;
  }

  private evaluateBoolExpr(expr: BoolExpr): boolean {
    switch (expr.type) {
      case 'flagTest':
        return this.state.getFlag(this.resolveFlagIndex(expr.name));
      case 'comparison': {
        const left = this.resolveNumericOperand(expr.left);
        const right = this.resolveNumericOperand(expr.right);
        switch (expr.op) {
          case '==':
            return left === right;
          case '!=':
            return left !== right;
          case '<':
            return left < right;
          case '>':
            return left > right;
        }
      }
      case 'not':
        return !this.evaluateBoolExpr(expr.expr);
      case 'and':
        return this.evaluateBoolExpr(expr.left) && this.evaluateBoolExpr(expr.right);
      case 'or':
        return this.evaluateBoolExpr(expr.left) || this.evaluateBoolExpr(expr.right);
      case 'call':
        return this.evaluateTestCall(expr);
    }
  }

  /** Resolves a command/test argument: literals pass through; symbols resolve to their declared index/value, or fall back to the bare name (e.g. a said() word that isn't a flag/var/object). */
  private resolveArgValue(literal: Literal): CommandArgValue {
    if (literal.kind === 'number' || literal.kind === 'string') {
      return literal.value;
    }
    const entry = this.symbols[literal.name];
    if (entry && (typeof entry.value === 'number' || typeof entry.value === 'string')) {
      return entry.value;
    }
    return literal.name;
  }

  /** Resolves a value used as a number: a literal number, or a symbol naming a var/flag (read live) or another numeric constant. */
  private resolveNumericOperand(literal: Literal): number {
    if (literal.kind === 'number') {
      return literal.value;
    }
    if (literal.kind === 'string') {
      throw new Error(`expected a numeric value but got string "${literal.value}"`);
    }
    const entry = this.symbols[literal.name];
    if (!entry) {
      throw new Error(`unresolved symbol: ${literal.name}`);
    }
    if (entry.kind === 'var' && typeof entry.value === 'number') {
      return this.state.getVar(entry.value);
    }
    if (entry.kind === 'flag' && typeof entry.value === 'number') {
      return this.state.getFlag(entry.value) ? 1 : 0;
    }
    if (typeof entry.value === 'number') {
      return entry.value;
    }
    throw new Error(`symbol "${literal.name}" does not resolve to a number`);
  }

  private resolveVarIndex(name: string): number {
    const entry = this.symbols[name];
    if (!entry || entry.kind !== 'var' || typeof entry.value !== 'number') {
      throw new Error(`cannot resolve "${name}" as a var`);
    }
    return entry.value;
  }

  private resolveFlagIndex(name: string): number {
    const entry = this.symbols[name];
    if (!entry || entry.kind !== 'flag' || typeof entry.value !== 'number') {
      throw new Error(`cannot resolve "${name}" as a flag`);
    }
    return entry.value;
  }

  private logOnce(key: string, message: string): void {
    if (this.loggedOnce.has(key)) {
      return;
    }
    this.loggedOnce.add(key);
    this.logger(message);
  }
}
