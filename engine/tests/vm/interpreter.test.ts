import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interpreter, type SymbolTable } from '../../src/vm/interpreter';
import { VmState } from '../../src/vm/state';
import type { CallNode, Logic, Statement } from '../../src/logic/ir';

function call(name: string, args: CallNode['args'] = []): CallNode {
  return { type: 'call', name, args };
}

function logicOf(...statements: Statement[]): Logic {
  return { statements };
}

describe('Interpreter: if/else branch selection', () => {
  let state: VmState;
  let symbols: SymbolTable;

  beforeEach(() => {
    state = new VmState();
    symbols = {
      'clock.on': { kind: 'flag', value: 10 },
      'my.var': { kind: 'var', value: 50 },
    };
  });

  it('runs the then-branch when a flag is set, the else-branch when it is not', () => {
    const thenCmd = vi.fn();
    const elseCmd = vi.fn();
    const logic = logicOf({
      type: 'if',
      test: { type: 'flagTest', name: 'clock.on' },
      then: [call('thenCmd')],
      else: [call('elseCmd')],
    });
    const interpreter = new Interpreter({
      state,
      symbols,
      logics: { 1: logic },
      commands: { thenCmd, elseCmd },
    });

    state.setFlag(10, true);
    interpreter.runLogic(1);
    expect(thenCmd).toHaveBeenCalledTimes(1);
    expect(elseCmd).not.toHaveBeenCalled();

    thenCmd.mockClear();
    state.setFlag(10, false);
    interpreter.runLogic(1);
    expect(thenCmd).not.toHaveBeenCalled();
    expect(elseCmd).toHaveBeenCalledTimes(1);
  });

  it('selects branches based on a var comparison', () => {
    const matchCmd = vi.fn();
    const noMatchCmd = vi.fn();
    const logic = logicOf({
      type: 'if',
      test: { type: 'comparison', op: '==', left: { kind: 'symbol', name: 'my.var' }, right: { kind: 'number', value: 5 } },
      then: [call('matchCmd')],
      else: [call('noMatchCmd')],
    });
    const interpreter = new Interpreter({
      state,
      symbols,
      logics: { 1: logic },
      commands: { matchCmd, noMatchCmd },
    });

    state.setVar(50, 5);
    interpreter.runLogic(1);
    expect(matchCmd).toHaveBeenCalledTimes(1);
    expect(noMatchCmd).not.toHaveBeenCalled();

    matchCmd.mockClear();
    state.setVar(50, 6);
    interpreter.runLogic(1);
    expect(matchCmd).not.toHaveBeenCalled();
    expect(noMatchCmd).toHaveBeenCalledTimes(1);
  });

  it('treats a var-kind symbol in flagTest position as a "!= 0" test', () => {
    const thenCmd = vi.fn();
    const elseCmd = vi.fn();
    const logic = logicOf({
      type: 'if',
      test: { type: 'flagTest', name: 'my.var' },
      then: [call('thenCmd')],
      else: [call('elseCmd')],
    });
    const interpreter = new Interpreter({
      state,
      symbols,
      logics: { 1: logic },
      commands: { thenCmd, elseCmd },
    });

    state.setVar(50, 0);
    interpreter.runLogic(1);
    expect(thenCmd).not.toHaveBeenCalled();
    expect(elseCmd).toHaveBeenCalledTimes(1);

    elseCmd.mockClear();
    state.setVar(50, 3);
    interpreter.runLogic(1);
    expect(thenCmd).toHaveBeenCalledTimes(1);
    expect(elseCmd).not.toHaveBeenCalled();
  });
});

describe('Interpreter: command dispatch', () => {
  it('invokes the registered impl with resolved args, and leaves other commands untouched', () => {
    const foo = vi.fn();
    const bar = vi.fn();
    const logic = logicOf(call('foo', [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }]));
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: logic },
      commands: { foo, bar },
    });

    interpreter.runLogic(1);
    expect(foo).toHaveBeenCalledWith({ state: expect.any(VmState), args: [1, 2] });
    expect(bar).not.toHaveBeenCalled();
  });

  it('resolves a symbol arg to its declared index rather than its live value', () => {
    const spy = vi.fn();
    const logic = logicOf(call('check', [{ kind: 'symbol', name: 'clock.on' }]));
    const interpreter = new Interpreter({
      state: new VmState(),
      symbols: { 'clock.on': { kind: 'flag', value: 10 } },
      logics: { 1: logic },
      commands: { check: spy },
    });

    interpreter.runLogic(1);
    expect(spy).toHaveBeenCalledWith({ state: expect.any(VmState), args: [10] });
  });

  it('treats an unimplemented command as a no-op that logs exactly once', () => {
    const logger = vi.fn();
    const logic = logicOf(call('mystery.cmd', [{ kind: 'number', value: 1 }]), call('mystery.cmd', [{ kind: 'number', value: 1 }]));
    const interpreter = new Interpreter({ state: new VmState(), logics: { 1: logic }, logger });

    expect(() => interpreter.runLogic(1)).not.toThrow();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('mystery.cmd');
  });
});

describe('Interpreter: error hardening', () => {
  it('a statement that throws during execution is swallowed, logged once, and execution continues', () => {
    const logger = vi.fn();
    const after = vi.fn();
    // "unset.var" has no symbol table entry, so resolveVarIndex() throws.
    const logic = logicOf(
      { type: 'assign', target: 'unset.var', op: '=', value: { kind: 'number', value: 1 } },
      { type: 'assign', target: 'unset.var', op: '=', value: { kind: 'number', value: 1 } },
      call('after')
    );
    const interpreter = new Interpreter({ state: new VmState(), logics: { 1: logic }, commands: { after }, logger });

    expect(() => interpreter.runLogic(1)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('unset.var');
  });

  it('an error thrown evaluating jumpIfFalse\'s test defaults the branch to not-taken', () => {
    const logger = vi.fn();
    const thenCmd = vi.fn();
    const elseCmd = vi.fn();
    // "unset.var" has no symbol table entry, so resolveNumericOperand() throws.
    const logic = logicOf({
      type: 'if',
      test: { type: 'comparison', op: '==', left: { kind: 'symbol', name: 'unset.var' }, right: { kind: 'number', value: 0 } },
      then: [call('thenCmd')],
      else: [call('elseCmd')],
    });
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: logic },
      commands: { thenCmd, elseCmd },
      logger,
    });

    expect(() => interpreter.runLogic(1)).not.toThrow();
    expect(thenCmd).not.toHaveBeenCalled();
    expect(elseCmd).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('unset.var');
  });
});

describe('Interpreter: test-function evaluator', () => {
  it('selects the then/else branch based on a registered test impl', () => {
    const thenCmd = vi.fn();
    const elseCmd = vi.fn();
    const myTest = vi.fn((ctx) => ctx.args[0] === 3);
    const logic = logicOf({
      type: 'if',
      test: { type: 'call', name: 'myTest', args: [{ kind: 'number', value: 3 }] },
      then: [call('thenCmd')],
      else: [call('elseCmd')],
    });
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: logic },
      commands: { thenCmd, elseCmd },
      tests: { myTest },
    });

    interpreter.runLogic(1);
    expect(myTest).toHaveBeenCalledWith({ state: expect.any(VmState), args: [3] });
    expect(thenCmd).toHaveBeenCalledTimes(1);
    expect(elseCmd).not.toHaveBeenCalled();
  });

  it('defaults an unimplemented test to false and logs once', () => {
    const logger = vi.fn();
    const thenCmd = vi.fn();
    const elseCmd = vi.fn();
    const logic = logicOf({
      type: 'if',
      test: { type: 'call', name: 'unknown.test', args: [] },
      then: [call('thenCmd')],
      else: [call('elseCmd')],
    });
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: logic },
      commands: { thenCmd, elseCmd },
      logger,
    });

    interpreter.runLogic(1);
    expect(thenCmd).not.toHaveBeenCalled();
    expect(elseCmd).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('evaluates not/and/or combinations', () => {
    const cmd = vi.fn();
    const logic = logicOf({
      type: 'if',
      test: {
        type: 'and',
        left: { type: 'flagTest', name: 'a' },
        right: { type: 'not', expr: { type: 'flagTest', name: 'b' } },
      },
      then: [call('cmd')],
    });
    const state = new VmState();
    const symbols: SymbolTable = { a: { kind: 'flag', value: 0 }, b: { kind: 'flag', value: 1 } };
    const interpreter = new Interpreter({ state, symbols, logics: { 1: logic }, commands: { cmd } });

    state.setFlag(0, true);
    state.setFlag(1, false);
    interpreter.runLogic(1);
    expect(cmd).toHaveBeenCalledTimes(1);

    cmd.mockClear();
    state.setFlag(1, true);
    interpreter.runLogic(1);
    expect(cmd).not.toHaveBeenCalled();
  });
});

describe('Interpreter: goto/labels', () => {
  it('skips statements between a goto and its label', () => {
    const first = vi.fn();
    const skipped = vi.fn();
    const after = vi.fn();
    const logic = logicOf(
      call('first'),
      { type: 'goto', label: 'skip' },
      call('skipped'),
      { type: 'label', name: 'skip' },
      call('after')
    );
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: logic },
      commands: { first, skipped, after },
    });

    interpreter.runLogic(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(skipped).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('supports a goto that jumps out of a nested if-block to a top-level label', () => {
    const insideIf = vi.fn();
    const afterIf = vi.fn();
    const exit = vi.fn();
    const logic = logicOf(
      {
        type: 'if',
        test: { type: 'flagTest', name: 'go' },
        then: [call('insideIf'), { type: 'goto', label: 'exit' }],
      },
      call('afterIf'),
      { type: 'label', name: 'exit' },
      call('exit')
    );
    const state = new VmState();
    const interpreter = new Interpreter({
      state,
      symbols: { go: { kind: 'flag', value: 0 } },
      logics: { 1: logic },
      commands: { insideIf, afterIf, exit },
    });

    state.setFlag(0, true);
    interpreter.runLogic(1);
    expect(insideIf).toHaveBeenCalledTimes(1);
    expect(afterIf).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('Interpreter: return', () => {
  it('stops only the current logic, resuming the caller right after call()', () => {
    const beforeReturn = vi.fn();
    const afterReturn = vi.fn();
    const afterCall = vi.fn();
    const callee = logicOf(call('beforeReturn'), { type: 'return' }, call('afterReturn'));
    const caller = logicOf(call('call', [{ kind: 'number', value: 2 }]), call('afterCall'));
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: caller, 2: callee },
      commands: { beforeReturn, afterReturn, afterCall },
    });

    interpreter.runLogic(1);
    expect(beforeReturn).toHaveBeenCalledTimes(1);
    expect(afterReturn).not.toHaveBeenCalled();
    expect(afterCall).toHaveBeenCalledTimes(1);
  });
});

describe('Interpreter: call/load.logics', () => {
  it('call() runs the named logic as a subroutine and returns control to the caller', () => {
    const calleeCmd = vi.fn();
    const callerBefore = vi.fn();
    const callerAfter = vi.fn();
    const caller = logicOf(call('callerBefore'), call('call', [{ kind: 'number', value: 2 }]), call('callerAfter'));
    const callee = logicOf(call('calleeCmd'));
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: caller, 2: callee },
      commands: { callerBefore, callerAfter, calleeCmd },
    });

    interpreter.runLogic(1);
    expect(callerBefore).toHaveBeenCalledTimes(1);
    expect(calleeCmd).toHaveBeenCalledTimes(1);
    expect(callerAfter).toHaveBeenCalledTimes(1);
  });

  it('load.logics() loads a not-yet-present logic via the configured loader, then call() can run it', () => {
    const loadedCmd = vi.fn();
    const loadedLogic = logicOf(call('loadedCmd'));
    const logicLoader = vi.fn((n: number) => (n === 5 ? loadedLogic : undefined));
    const caller = logicOf(
      call('load.logics', [{ kind: 'number', value: 5 }]),
      call('call', [{ kind: 'number', value: 5 }])
    );
    const interpreter = new Interpreter({
      state: new VmState(),
      logics: { 1: caller },
      commands: { loadedCmd },
      logicLoader,
    });

    interpreter.runLogic(1);
    expect(logicLoader).toHaveBeenCalledWith(5);
    expect(loadedCmd).toHaveBeenCalledTimes(1);
  });

  it('load.logics() with no loader configured logs once and does not crash', () => {
    const logger = vi.fn();
    const caller = logicOf(call('load.logics', [{ kind: 'number', value: 99 }]));
    const interpreter = new Interpreter({ state: new VmState(), logics: { 1: caller }, logger });

    expect(() => interpreter.runLogic(1)).not.toThrow();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('99');
  });

  it('calling a missing logic number logs once and does not crash', () => {
    const logger = vi.fn();
    const caller = logicOf(call('call', [{ kind: 'number', value: 42 }]));
    const interpreter = new Interpreter({ state: new VmState(), logics: { 1: caller }, logger });

    expect(() => interpreter.runLogic(1)).not.toThrow();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('42');
  });
});

describe('Interpreter: runCycle and new.room', () => {
  it('runs logic 0 then the current room logic each tick', () => {
    const logic0Cmd = vi.fn();
    const roomCmd = vi.fn();
    const state = new VmState();
    state.setCurrentRoom(3);
    const interpreter = new Interpreter({
      state,
      logics: { 0: logicOf(call('logic0Cmd')), 3: logicOf(call('roomCmd')) },
      commands: { logic0Cmd, roomCmd },
    });

    interpreter.runCycle();
    expect(logic0Cmd).toHaveBeenCalledTimes(1);
    expect(roomCmd).toHaveBeenCalledTimes(1);
  });

  it('new.room switches the active room and defers the new room logic to the next cycle', () => {
    const oldRoomCmd = vi.fn();
    const newRoomCmd = vi.fn();
    const state = new VmState();
    state.setCurrentRoom(1);
    // Logic 0 only fires new.room the first tick (guarded by a var), matching
    // how real room-transition logic behaves - otherwise every later tick
    // would re-trigger the transition and the room logic could never run.
    const logic0 = logicOf({
      type: 'if',
      test: { type: 'comparison', op: '==', left: { kind: 'symbol', name: 'moved' }, right: { kind: 'number', value: 0 } },
      // new.room aborts the cycle immediately - real AGI semantics - so the
      // guard must be set *before* calling it, not after.
      then: [{ type: 'incdec', target: 'moved', op: '++' }, call('new.room', [{ kind: 'number', value: 7 }])],
    });
    const interpreter = new Interpreter({
      state,
      symbols: { moved: { kind: 'var', value: 60 } },
      logics: {
        0: logic0,
        1: logicOf(call('oldRoomCmd')),
        7: logicOf(call('newRoomCmd')),
      },
      commands: { oldRoomCmd, newRoomCmd },
    });

    interpreter.runCycle();
    expect(state.getCurrentRoom()).toBe(7);
    expect(oldRoomCmd).not.toHaveBeenCalled();
    expect(newRoomCmd).not.toHaveBeenCalled();

    interpreter.runCycle();
    expect(newRoomCmd).toHaveBeenCalledTimes(1);
  });

  it('new.room fired from a nested call() aborts the whole cycle immediately', () => {
    const afterNewRoom = vi.fn();
    const roomCmd = vi.fn();
    const state = new VmState();
    state.setCurrentRoom(1);
    const interpreter = new Interpreter({
      state,
      logics: {
        0: logicOf(call('call', [{ kind: 'number', value: 9 }]), call('afterNewRoom')),
        9: logicOf(call('new.room', [{ kind: 'number', value: 7 }])),
        1: logicOf(call('roomCmd')),
      },
      commands: { afterNewRoom, roomCmd },
    });

    interpreter.runCycle();
    expect(state.getCurrentRoom()).toBe(7);
    expect(afterNewRoom).not.toHaveBeenCalled();
    expect(roomCmd).not.toHaveBeenCalled();
  });
});
