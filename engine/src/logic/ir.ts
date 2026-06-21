/**
 * IR for a parsed AGI logic file. Commands and tests are both represented as
 * the same generic {@link CallNode} shape (name + args) - the parser doesn't
 * know or care which command/test names exist; the VM resolves that later.
 */

export type Literal =
  | { kind: 'number'; value: number }
  | { kind: 'symbol'; name: string }
  | { kind: 'string'; value: string };

/** A command call (as a statement) or a test-function call (inside a BoolExpr) - same shape either way. */
export interface CallNode {
  type: 'call';
  name: string;
  args: Literal[];
}

/** Bare identifier used as a boolean test, e.g. `if (clock.on)` - true if the named flag/var is truthy. */
export interface FlagTestNode {
  type: 'flagTest';
  name: string;
}

export interface ComparisonNode {
  type: 'comparison';
  op: '==' | '!=' | '<' | '>';
  left: Literal;
  right: Literal;
}

export interface NotNode {
  type: 'not';
  expr: BoolExpr;
}

export interface AndNode {
  type: 'and';
  left: BoolExpr;
  right: BoolExpr;
}

export interface OrNode {
  type: 'or';
  left: BoolExpr;
  right: BoolExpr;
}

export type BoolExpr = CallNode | FlagTestNode | ComparisonNode | NotNode | AndNode | OrNode;

export interface IfStatement {
  type: 'if';
  test: BoolExpr;
  then: Statement[];
  else?: Statement[];
}

export interface AssignStatement {
  type: 'assign';
  target: string;
  /**
   * '@=' and '=@' are AGI's indirect-addressing assignments (the
   * "lindirectn"/"lindirectv"/"rindirect" opcodes, confirmed by SRC/RM99.CG's
   * debug console: `debug.1 =@ debug.0` reads "the var numbered debug.0" into
   * debug.1, and `debug.0 @= debug.1` writes debug.1 into "the var numbered
   * debug.0"):
   *  - '@=': indirect on the left - vars[target] = value (target's own
   *    value is the *address* of the var being written).
   *  - '=@': indirect on the right - target = vars[value] (value's own
   *    value is the *address* of the var being read).
   */
  op: '=' | '+=' | '-=' | '@=' | '=@';
  value: Literal;
}

export interface IncDecStatement {
  type: 'incdec';
  target: string;
  op: '++' | '--';
}

export interface GotoStatement {
  type: 'goto';
  label: string;
}

export interface LabelStatement {
  type: 'label';
  name: string;
}

export interface ReturnStatement {
  type: 'return';
}

export type Statement =
  | CallNode
  | IfStatement
  | AssignStatement
  | IncDecStatement
  | GotoStatement
  | LabelStatement
  | ReturnStatement;

export interface Logic {
  statements: Statement[];
}
