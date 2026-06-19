/**
 * The AGI animated-object table: ego (object 0) plus up to 16 screen
 * objects, each with a view/loop/cel, per-object step/cycle timers, a
 * motion mode, and the handful of control flags real AGI logics flip
 * (observe.horizon, ignore.blocks, ...). {@link ObjectTable.update} advances
 * every animated object by one game cycle - stepping its motion mode and
 * advancing its cel - and resolves screen-edge/horizon/block collisions,
 * setting the reserved border vars {@link VmState} already exposes
 * (EgoBorderTouched / ObjectBorderTouched / ObjectBorderCode).
 *
 * Position and priority are stored on {@link VmState} itself (not duplicated
 * here) since `position`/`get.posn`/`set.priority` already read and write
 * them there and the placeholder renderer reads coordinates from the same
 * place; this module owns everything else AGI tracks per animated object.
 *
 * There's no VIEW resource decoder yet, so loop cel-counts are supplied by
 * the caller via {@link ObjectTableOptions.getCelCount} rather than read
 * from a real view - that keeps this module testable without one.
 */

import { ReservedVar, type VmState } from './state';

export const EGO_OBJECT = 0;
export const MAX_ANIMATED_OBJECTS = 16;

// AGI's logical screen is 160x200; the bottom rows are reserved for the
// input line, so the picture/object area runs y 0-167. Per this game's own
// SRC/GAMEDEFS.H there is no override, so these match AGI's own defaults.
export const SCREEN_MIN_X = 0;
export const SCREEN_MAX_X = 159;
export const SCREEN_MIN_Y = 0;
export const SCREEN_MAX_Y = 167;
export const DEFAULT_HORIZON = 36;

/** Edge codes AGI reports via the ObjectBorderCode/EgoBorderTouched vars. */
export enum Edge {
  None = 0,
  Top = 1,
  Right = 2,
  Bottom = 3,
  Left = 4,
}

export type MotionMode = 'normal' | 'wander' | 'follow' | 'move';
export type CycleMode = 'normal' | 'endLoop' | 'reverseLoop' | 'reverseCycle';

interface MoveOrder {
  x: number;
  y: number;
  stepSize: number;
  doneFlag: number;
}

interface FollowOrder {
  target: number;
  stepSize: number;
  doneFlag: number;
}

interface EndCycleOrder {
  doneFlag: number;
}

export interface AnimatedObject {
  readonly number: number;
  view: number;
  loop: number;
  cel: number;
  direction: number;
  stepSize: number;
  stepTime: number;
  cycleTime: number;
  motion: MotionMode;
  cycleMode: CycleMode;
  cycling: boolean;
  observeHorizon: boolean;
  ignoreBlocks: boolean;
  /** False once `stop.update` has frozen this object's motion and cycling; `start.update` resumes it. Unlike unanimate(), the object stays in the animated set. */
  updating: boolean;
  /** Set by `fix.loop`/`release.loop`. There's no direction-driven auto loop-selection implemented, so this is tracked as observable state only. */
  loopFixed: boolean;
  /** Set by `ignore.objs`/`observe.objs`. There's no per-object bounding-box collision implemented (no view dimensions to do it correctly), so this is tracked as observable state only. */
  ignoreObjs: boolean;
  /** Set by `force.update`. There's no render caching to bypass, so this is tracked as observable state only. */
  forceUpdate: boolean;
}

interface InternalObject extends AnimatedObject {
  stepCount: number;
  cycleCount: number;
  wanderCount: number;
  moveOrder: MoveOrder | null;
  followOrder: FollowOrder | null;
  endCycleOrder: EndCycleOrder | null;
}

interface BlockRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** (dx, dy) unit step for each of AGI's 9 directions (0 = stopped, 1 = N, clockwise to 8 = NW). */
const DIRECTION_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Inverse of {@link DIRECTION_DELTAS}, keyed by `"sign(dx),sign(dy)"`. */
const DIRECTION_BY_SIGN = new Map<string, number>(DIRECTION_DELTAS.map(([dx, dy], direction) => [`${dx},${dy}`, direction]));

function directionTowards(dx: number, dy: number): number {
  return DIRECTION_BY_SIGN.get(`${Math.sign(dx)},${Math.sign(dy)}`) ?? 0;
}

function defaultObject(number: number): InternalObject {
  return {
    number,
    view: 0,
    loop: 0,
    cel: 0,
    direction: 0,
    stepSize: 1,
    stepTime: 1,
    cycleTime: 1,
    motion: 'normal',
    cycleMode: 'normal',
    cycling: false,
    observeHorizon: true,
    ignoreBlocks: false,
    updating: true,
    loopFixed: false,
    ignoreObjs: false,
    forceUpdate: false,
    stepCount: 0,
    cycleCount: 0,
    wanderCount: 0,
    moveOrder: null,
    followOrder: null,
    endCycleOrder: null,
  };
}

/** Strips the bookkeeping-only fields off an internal record for callers. */
function toPublic(obj: InternalObject): AnimatedObject {
  const {
    number,
    view,
    loop,
    cel,
    direction,
    stepSize,
    stepTime,
    cycleTime,
    motion,
    cycleMode,
    cycling,
    observeHorizon,
    ignoreBlocks,
    updating,
    loopFixed,
    ignoreObjs,
    forceUpdate,
  } = obj;
  return {
    number,
    view,
    loop,
    cel,
    direction,
    stepSize,
    stepTime,
    cycleTime,
    motion,
    cycleMode,
    cycling,
    observeHorizon,
    ignoreBlocks,
    updating,
    loopFixed,
    ignoreObjs,
    forceUpdate,
  };
}

export interface ObjectTableOptions {
  state: VmState;
  /** Number of cels in `loop` of `view`; defaults to always reporting 1 (a single-cel loop). */
  getCelCount?: (view: number, loop: number) => number;
  /** Source of randomness for wander's direction changes; defaults to {@link Math.random}. Inject a fake for deterministic tests. */
  random?: () => number;
}

export class ObjectTable {
  private readonly state: VmState;
  private readonly getCelCountFn: (view: number, loop: number) => number;
  private readonly random: () => number;
  private readonly objects = new Map<number, InternalObject>();
  private horizon = DEFAULT_HORIZON;
  private block: BlockRect | null = null;

  constructor(options: ObjectTableOptions) {
    this.state = options.state;
    this.getCelCountFn = options.getCelCount ?? (() => 1);
    this.random = options.random ?? Math.random;
    this.objects.set(EGO_OBJECT, defaultObject(EGO_OBJECT));
  }

  private assertObjectNumber(objectNumber: number): void {
    if (!Number.isInteger(objectNumber) || objectNumber < 0 || objectNumber > MAX_ANIMATED_OBJECTS) {
      throw new RangeError(`object index out of range: ${objectNumber} (expected 0-${MAX_ANIMATED_OBJECTS})`);
    }
  }

  /** Marks `objectNumber` as animated (creating its record with defaults if new) and returns it. */
  animate(objectNumber: number): AnimatedObject {
    this.assertObjectNumber(objectNumber);
    let obj = this.objects.get(objectNumber);
    if (!obj) {
      obj = defaultObject(objectNumber);
      this.objects.set(objectNumber, obj);
    }
    return toPublic(obj);
  }

  /** Removes `objectNumber` from the animated set; {@link update} will skip it. Ego (0) can't be unanimated. */
  unanimate(objectNumber: number): void {
    this.assertObjectNumber(objectNumber);
    if (objectNumber === EGO_OBJECT) return;
    this.objects.delete(objectNumber);
  }

  isAnimated(objectNumber: number): boolean {
    return this.objects.has(objectNumber);
  }

  private get(objectNumber: number): InternalObject {
    const obj = this.objects.get(objectNumber);
    if (!obj) {
      throw new Error(`object ${objectNumber} is not animated - call animate() first`);
    }
    return obj;
  }

  getObject(objectNumber: number): AnimatedObject {
    return toPublic(this.get(objectNumber));
  }

  setView(objectNumber: number, view: number): void {
    this.get(objectNumber).view = view;
  }

  setLoop(objectNumber: number, loop: number): void {
    this.get(objectNumber).loop = loop;
  }

  setCel(objectNumber: number, cel: number): void {
    this.get(objectNumber).cel = cel;
  }

  setDirection(objectNumber: number, direction: number): void {
    this.get(objectNumber).direction = direction;
  }

  setStepSize(objectNumber: number, size: number): void {
    this.get(objectNumber).stepSize = size;
  }

  setStepTime(objectNumber: number, time: number): void {
    const obj = this.get(objectNumber);
    obj.stepTime = time;
    obj.stepCount = 0;
  }

  setCycleTime(objectNumber: number, time: number): void {
    const obj = this.get(objectNumber);
    obj.cycleTime = time;
    obj.cycleCount = 0;
  }

  setObserveHorizon(objectNumber: number, observe: boolean): void {
    this.get(objectNumber).observeHorizon = observe;
  }

  setIgnoreBlocks(objectNumber: number, ignore: boolean): void {
    this.get(objectNumber).ignoreBlocks = ignore;
  }

  setHorizon(y: number): void {
    this.horizon = y;
  }

  getHorizon(): number {
    return this.horizon;
  }

  setBlock(x1: number, y1: number, x2: number, y2: number): void {
    this.block = { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  }

  clearBlock(): void {
    this.block = null;
  }

  // --- Cycling -------------------------------------------------------

  startCycling(objectNumber: number): void {
    this.get(objectNumber).cycling = true;
  }

  stopCycling(objectNumber: number): void {
    this.get(objectNumber).cycling = false;
  }

  normalCycle(objectNumber: number): void {
    const obj = this.get(objectNumber);
    obj.cycleMode = 'normal';
    obj.endCycleOrder = null;
    obj.cycling = true;
  }

  reverseCycle(objectNumber: number): void {
    const obj = this.get(objectNumber);
    obj.cycleMode = 'reverseCycle';
    obj.endCycleOrder = null;
    obj.cycling = true;
  }

  /** Cycles forward to the last cel of the current loop, then stops cycling and sets `doneFlag`. */
  endLoop(objectNumber: number, doneFlag: number): void {
    const obj = this.get(objectNumber);
    obj.cycleMode = 'endLoop';
    obj.endCycleOrder = { doneFlag };
    obj.cycling = true;
  }

  /** Cycles backward to cel 0 of the current loop, then stops cycling and sets `doneFlag`. */
  reverseLoop(objectNumber: number, doneFlag: number): void {
    const obj = this.get(objectNumber);
    obj.cycleMode = 'reverseLoop';
    obj.endCycleOrder = { doneFlag };
    obj.cycling = true;
  }

  // --- Update/loop/collision flags --------------------------------------

  startUpdate(objectNumber: number): void {
    this.get(objectNumber).updating = true;
  }

  stopUpdate(objectNumber: number): void {
    this.get(objectNumber).updating = false;
  }

  fixLoop(objectNumber: number): void {
    this.get(objectNumber).loopFixed = true;
  }

  releaseLoop(objectNumber: number): void {
    this.get(objectNumber).loopFixed = false;
  }

  setIgnoreObjs(objectNumber: number, ignore: boolean): void {
    this.get(objectNumber).ignoreObjs = ignore;
  }

  forceUpdate(objectNumber: number): void {
    this.get(objectNumber).forceUpdate = true;
  }

  /** Exposes the configured cel-count lookup (clamped to at least 1) for callers like `last.cel` that need it outside a cycling update. */
  getCelCount(view: number, loop: number): number {
    return Math.max(1, this.getCelCountFn(view, loop));
  }

  /** Moves an object directly to (x, y), bypassing screen/horizon clamping and cancelling any in-progress move/follow order - AGI's `reposition.to`. */
  repositionTo(objectNumber: number, x: number, y: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'normal';
    obj.moveOrder = null;
    obj.followOrder = null;
    this.state.setPosition(objectNumber, x, y);
  }

  // --- Motion ----------------------------------------------------------

  normalMotion(objectNumber: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'normal';
    obj.moveOrder = null;
    obj.followOrder = null;
  }

  stopMotion(objectNumber: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'normal';
    obj.direction = 0;
    obj.moveOrder = null;
    obj.followOrder = null;
  }

  wander(objectNumber: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'wander';
    obj.moveOrder = null;
    obj.followOrder = null;
    this.pickWanderDirection(obj);
  }

  moveObj(objectNumber: number, x: number, y: number, stepSize: number, doneFlag: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'move';
    obj.moveOrder = { x, y, stepSize, doneFlag };
    this.state.resetFlag(doneFlag);
  }

  followEgo(objectNumber: number, stepSize: number, doneFlag: number): void {
    const obj = this.get(objectNumber);
    obj.motion = 'follow';
    obj.followOrder = { target: EGO_OBJECT, stepSize, doneFlag };
    this.state.resetFlag(doneFlag);
  }

  private pickWanderDirection(obj: InternalObject): void {
    obj.direction = 1 + Math.floor(this.random() * 8);
    obj.wanderCount = 5 + Math.floor(this.random() * 20);
  }

  // --- Per-cycle update --------------------------------------------------

  /** Advances every animated object by one game cycle: motion, then cycling. */
  update(): void {
    for (const objectNumber of [...this.objects.keys()].sort((a, b) => a - b)) {
      const obj = this.objects.get(objectNumber)!;
      if (!obj.updating) continue;
      this.updateMotion(obj);
      this.updateCycling(obj);
    }
  }

  private updateMotion(obj: InternalObject): void {
    switch (obj.motion) {
      case 'normal':
        this.stepInDirection(obj, obj.direction);
        return;
      case 'wander':
        this.updateWander(obj);
        return;
      case 'move':
        this.updateMove(obj);
        return;
      case 'follow':
        this.updateFollow(obj);
        return;
    }
  }

  private updateWander(obj: InternalObject): void {
    if (obj.wanderCount <= 0) {
      this.pickWanderDirection(obj);
    }
    if (!this.tickStepTimer(obj)) return;
    const [dx, dy] = DIRECTION_DELTAS[obj.direction];
    const { moved, edge } = this.applyStep(obj, dx * obj.stepSize, dy * obj.stepSize);
    obj.wanderCount--;
    if (!moved || edge !== Edge.None) {
      // Bounced off an edge or a blocked area - pick a new direction now
      // rather than waiting out the rest of the wander timer stuck in place.
      this.pickWanderDirection(obj);
    }
  }

  private updateMove(obj: InternalObject): void {
    const order = obj.moveOrder;
    if (!order) {
      obj.motion = 'normal';
      return;
    }
    if (!this.tickStepTimer(obj)) return;

    const { x, y } = this.state.getPosition(obj.number);
    const dx = order.x - x;
    const dy = order.y - y;
    if (dx === 0 && dy === 0) {
      this.finishMove(obj, order);
      return;
    }

    obj.direction = directionTowards(dx, dy);
    const stepX = Math.sign(dx) * Math.min(order.stepSize, Math.abs(dx));
    const stepY = Math.sign(dy) * Math.min(order.stepSize, Math.abs(dy));
    this.applyStep(obj, stepX, stepY);

    const after = this.state.getPosition(obj.number);
    if (after.x === order.x && after.y === order.y) {
      this.finishMove(obj, order);
    }
  }

  private finishMove(obj: InternalObject, order: MoveOrder): void {
    obj.motion = 'normal';
    obj.direction = 0;
    obj.moveOrder = null;
    this.state.setFlag(order.doneFlag, true);
  }

  private updateFollow(obj: InternalObject): void {
    const order = obj.followOrder;
    if (!order) {
      obj.motion = 'normal';
      return;
    }
    if (!this.tickStepTimer(obj)) return;

    const { x, y } = this.state.getPosition(obj.number);
    const targetPos = this.state.getPosition(order.target);
    const dx = targetPos.x - x;
    const dy = targetPos.y - y;

    if (Math.abs(dx) <= order.stepSize && Math.abs(dy) <= order.stepSize) {
      this.state.setFlag(order.doneFlag, true);
      return;
    }

    obj.direction = directionTowards(dx, dy);
    const stepX = Math.sign(dx) * Math.min(order.stepSize, Math.abs(dx));
    const stepY = Math.sign(dy) * Math.min(order.stepSize, Math.abs(dy));
    this.applyStep(obj, stepX, stepY);
  }

  /** Steps `obj` one stepSize in `direction`, respecting step timing. */
  private stepInDirection(obj: InternalObject, direction: number): void {
    if (direction === 0) return;
    if (!this.tickStepTimer(obj)) return;
    const [dx, dy] = DIRECTION_DELTAS[direction];
    this.applyStep(obj, dx * obj.stepSize, dy * obj.stepSize);
  }

  /** True once `stepTime` calls have accumulated, meaning it's time for this object to move this cycle. */
  private tickStepTimer(obj: InternalObject): boolean {
    obj.stepCount++;
    if (obj.stepCount < obj.stepTime) return false;
    obj.stepCount = 0;
    return true;
  }

  /**
   * Moves `obj` by (dx, dy), clamped to the screen edges and the horizon and
   * cancelled entirely if it would enter the blocked rectangle. Sets the
   * border-touched reserved vars when an edge is hit. Returns whether the
   * object's position actually changed and which edge (if any) it hit.
   */
  private applyStep(obj: InternalObject, dx: number, dy: number): { moved: boolean; edge: Edge } {
    const { x, y } = this.state.getPosition(obj.number);
    let nextX = x + dx;
    let nextY = y + dy;

    let edge = Edge.None;
    if (nextX < SCREEN_MIN_X) {
      nextX = SCREEN_MIN_X;
      edge = Edge.Left;
    } else if (nextX > SCREEN_MAX_X) {
      nextX = SCREEN_MAX_X;
      edge = Edge.Right;
    }
    if (nextY < SCREEN_MIN_Y) {
      nextY = SCREEN_MIN_Y;
      edge = Edge.Top;
    } else if (nextY > SCREEN_MAX_Y) {
      nextY = SCREEN_MAX_Y;
      edge = Edge.Bottom;
    }

    if (obj.observeHorizon && nextY < this.horizon) {
      nextY = this.horizon;
    }

    if (this.block && !obj.ignoreBlocks && this.intersectsBlock(nextX, nextY)) {
      return { moved: false, edge: Edge.None };
    }

    if (edge !== Edge.None) {
      this.reportEdge(obj.number, edge);
    }

    if (nextX === x && nextY === y) {
      return { moved: false, edge };
    }

    this.state.setPosition(obj.number, nextX, nextY);
    return { moved: true, edge };
  }

  private intersectsBlock(x: number, y: number): boolean {
    const block = this.block!;
    return x >= block.x1 && x <= block.x2 && y >= block.y1 && y <= block.y2;
  }

  private reportEdge(objectNumber: number, edge: Edge): void {
    if (objectNumber === EGO_OBJECT) {
      this.state.setVar(ReservedVar.EgoBorderTouched, edge);
    } else {
      this.state.setVar(ReservedVar.ObjectBorderTouched, objectNumber);
      this.state.setVar(ReservedVar.ObjectBorderCode, edge);
    }
  }

  private updateCycling(obj: InternalObject): void {
    if (!obj.cycling) return;
    obj.cycleCount++;
    if (obj.cycleCount < obj.cycleTime) return;
    obj.cycleCount = 0;

    const celCount = this.getCelCount(obj.view, obj.loop);

    switch (obj.cycleMode) {
      case 'normal':
        obj.cel = (obj.cel + 1) % celCount;
        return;
      case 'reverseCycle':
        obj.cel = (obj.cel - 1 + celCount) % celCount;
        return;
      case 'endLoop':
        obj.cel = Math.min(obj.cel + 1, celCount - 1);
        if (obj.cel >= celCount - 1) {
          this.finishEndCycle(obj);
        }
        return;
      case 'reverseLoop':
        obj.cel = Math.max(obj.cel - 1, 0);
        if (obj.cel <= 0) {
          this.finishEndCycle(obj);
        }
        return;
    }
  }

  private finishEndCycle(obj: InternalObject): void {
    obj.cycling = false;
    obj.cycleMode = 'normal';
    const order = obj.endCycleOrder;
    obj.endCycleOrder = null;
    if (order) {
      this.state.setFlag(order.doneFlag, true);
    }
  }
}
