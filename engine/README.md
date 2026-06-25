# KQ3 engine

A from-scratch AGI v2 interpreter and renderer for King's Quest III, built
against this repo's real `SRC/RM*.CG` logic sources, `PIC`/`SND`/`OBJECT`/
`WORDS.TOK` resources, and `engine/src/**`'s own VM/render/input modules - no
emulator, no original interpreter binary.

## Running it

```sh
npm install
npm run build:logic   # compiles SRC/*.CG -> src/generated/{logic-bundle,symbols,messages}.json
npm run dev            # serves index.html (the real game) and viewer.html (the asset/demo viewer)
```

`src/main.ts` is the real game: it boots the compiled logic bundle into an
`Interpreter` wired to every subsystem (`VmState`, `ObjectTable`, picture/
sprite rendering, sound, the text parser, the menu bar) and drives it on a
fixed-rate timer. `npm run build:logic` must be run first - the compiled
bundle is gitignored build output (`src/generated/`), not checked in.
`src/viewer.ts` (viewer.html) is a separate, standalone exerciser for each
resource decoder and render primitive in isolation; it doesn't run the
Interpreter against real room logic the way main.ts does.

`npm run discover-gaps` boots every one of the 124 compiled room logics in
isolation against a fresh `VmState` for a handful of cycles and reports which
commands/tests/logics throw or are unimplemented - the empirical "does this
room's logic load and run" gap report this pass worked from.

## Manual smoke test

After `npm run build:logic` + `npm run dev`, open the served `index.html`
and check:

1. **Boot transition (room 0 -> room 45).** The page should load straight
   into room 45 (the game's real opening room) within a second - the debug
   panel's `room = ` line should read `45`, not `0`. This is the same
   `new.room(45)` transition `tests/integration/conductor.test.ts` exercises
   headlessly (see `SRC/RM0.CG`'s startup block).
2. **Ego renders and responds to input.** A coloured box (ego's placeholder
   sprite - see "No VIEW resources" below) should be visible and move with
   the arrow keys; `ego.dir` in the debug panel should update accordingly.
3. **The parser and menu both reach the room logic.** Press Enter, type
   `look`, and press Enter again - a response message should print to the
   on-page log. Press F10 to open the menu bar and confirm it navigates with
   arrow keys and Enter without throwing (check the browser console for
   uncaught errors).
4. **No console errors.** The browser console should show no thrown
   exceptions; occasional `unimplemented command`/`picture resource not
   found` warnings are expected (see "Known deviations" below) but
   `unresolved symbol`/`cannot resolve ... as a flag or var` should never
   appear - that's the regression class both `tests/integration/all-
   rooms.test.ts` and `tests/integration/conductor.test.ts` guard against.

## Cycle timing

The game loop in `src/main.ts` ticks every 50ms - AGI's own base interpreter
rate, roughly 20 cycles/sec - calling `Interpreter.runCycle()` then
`ObjectTable.update()` then a full render, once per tick. This is the rate
*before* any `set.speed`-style slowdown; see "Known deviations" below for why
that part of the original menu has no effect here.

## Known deviations from the original game

These are deliberate, scoped-out gaps rather than bugs - documented here so
they're not mistaken for unfinished fixes.

- **No VIEW resources, so no real sprites.** This repo's asset dump has
  `PIC`, `SND`, `OBJECT`, and `WORDS.TOK`, but no `VIEW` directory - so there
  are no view/loop/cel bitmaps to decode or animate. `src/render/sprites.ts`
  draws every animated object (ego included) as a flat coloured box sized
  like a typical AGI cel, anchored at the object's (x, y) the same way a real
  cel is (x = left edge, y = bottom), and coloured by its effective priority
  band. Positions, motion, and priority are all real and driven by the same
  VM state real view cels would be; only the pixels are a placeholder.
- **`set.speed`-style menu items are inert.** RM0.CG's own menu (Game ->
  Speed: Normal/Slow/Fast/Fastest, controllers `c.speed.*`) exists and is
  selectable, but nothing in this engine maps those controllers to a cycle-
  skipping mechanism. The loop always runs at the fixed ~20 cycles/sec
  described above.
- **Debug/help screens that busy-wait on `have.key()` abort instead of
  blocking.** `lgc.wiz.status` (logic 92) and `lgc.help` (logic 102) - both
  debug-only screens reached via the `debugging` flag, not normal gameplay -
  use a tight `goto`-loop that polls `have.key()` synchronously until a key
  is pressed, exactly how real DOS AGI read the keyboard inline within a
  single interpreter tick. A browser's input model can't satisfy that
  synchronously (key events arrive on the JS event loop, which can't run
  *during* a synchronous `runCycle()` call), so these hit the interpreter's
  runaway-op safety valve (`MAX_OPS_PER_LOGIC` in `src/vm/interpreter.ts`)
  and abort that turn rather than truly pausing. Fixing this for real would
  mean turning the interpreter into a coroutine that can suspend mid-cycle
  and resume on a later keypress - out of scope here, and irrelevant to
  normal play since both screens are debug-only.
- **`draw.pic`/`load.pic` with a self-referencing var argument resolve to
  the var's declared index, not its live value.** Most rooms call
  `draw.pic(<literal number>)`; a couple (RM62.CG, RM87.CG) instead write
  `load.pic(current.room); draw.pic(current.room);` - using the reserved
  `current.room` *var* as a "draw my own room's picture" idiom. Real AGI's
  compiler picks the immediate-vs-variable encoding per argument based on
  the source token (confirmed elsewhere in this codebase - see
  `objectCommands.ts`'s `cycle.time`/`step.size`/etc. doc comment), so that
  idiom should read the var's *current value* (62, 87, ...) at runtime.
  This engine's generic command-argument resolver instead substitutes the
  var's *declared index* (0, since `current.room` is var 0) for every
  command uniformly, which is correct for the much more common case of
  output-parameter arguments (`get.posn(ego, ego.x, ego.y)`,
  `random(1, 4, work)`, ...) but wrong for this one self-referencing idiom.
  Net effect: those two rooms' background picture doesn't load (logged once
  via `draw.pic(0): picture resource not found`); everything else about
  them (objects, priority, exits, scripted events) is unaffected. Fixing
  this properly means threading per-command "this argument is a value, not
  an address" typing through the interpreter's dispatch, which would touch
  every command - left as a documented, narrow miss rather than risking the
  much larger set of commands that *do* need index semantics.
- **`%message` resolution approximates "which logic owns this number."**
  Real AGI message tables are per-logic; `CommandContext` (the interface
  every command/test implementation receives) doesn't carry "which logic is
  currently executing," so `src/main.ts`'s `resolveMessage` falls back to
  "the current room's table, else logic 0's." This covers the overwhelming
  majority of `print`/`display`/menu-label calls (which run from the active
  room's own logic), but a message raised while a *non-resident* logic is
  running on the room's behalf (e.g. one of the spell-casting sub-logics,
  121-127, invoked via `call.f(spell.in.progress)` from room 43) would
  resolve against the wrong table if the room and the called logic both
  define the same message number differently. Exposing the interpreter's
  real per-call "current logic" to commands would fix this properly; not
  done here to avoid widening `CommandContext` for every command.
- **`discover-gaps`'s room-43 (`rm.spells`) recursion warning is a test-
  harness artifact, not an engine bug.** RM43.CG unconditionally calls
  `call.f(spell.in.progress)` every cycle; in real play, `spell.in.progress`
  is always pre-set to a real spell logic number (121-127) by RM10.CG
  *before* it transitions into room 43, so that call always lands on a real
  spell logic. `discover-gaps` boots room 43 in isolation from a blank
  `VmState` (skipping RM10.CG's setup), so `spell.in.progress` is 0, and
  `call.f(0)` calls logic 0 - which itself unconditionally calls back into
  the current room, recursing forever until the interpreter's call-depth
  guard aborts it. Verified by replaying the same room with
  `spell.in.progress` pre-set the way RM10.CG actually sets it: no
  recursion, runs cleanly for hundreds of cycles.

## Fidelity fixes made in this pass

Found via `discover-gaps` (it went from 103 unique unimplemented/error
messages down to 6 - the remainder being the deviations documented above)
and confirmed against the real `SRC/*.CG` source:

- **`%`/`#` are interchangeable directive prefixes**, not a live/disabled
  distinction (`src/logic/preprocess.ts`). `GAMEDEFS.REH` is written
  entirely in `#flag`/`#var`/`#define`, yet defines flags (`eagleHere`,
  `bombsAway`, ...) that many rooms genuinely set/reset/test at runtime;
  some rooms `%include` it, others `#include` it, interchangeably. Treating
  `#` as "disabled" (the previous assumption) silently dropped the large
  majority of this game's flag/var/message declarations.
- **AGI's reserved `init.log` flag (flag 5) is now actually managed.** It
  was defined (`ReservedFlag.InitLogs`) but never set or cleared anywhere,
  so no room's `if (init.log) { ...one-time setup... }` block ever ran.
  `new.room`/`new.room.f` now set it; `Interpreter.runCycle()` clears it
  once the new room's first pass has actually completed.
- **`have.input` (flag 2) is now cleared after the tick that saw it**, so a
  submitted parser line is processed once instead of being reprocessed
  forever on every later tick.
- **`@=`/`=@` are AGI's indirect-addressing assignments**
  (lindirectn/lindirectv/rindirect: `vars[target] = value` and
  `target = vars[value]`), not - as previously assumed - typos for plain
  `=`. Confirmed by RM99.CG's debug console (`debug.1 =@ debug.0` implements
  "show var", `debug.0 @= debug.1` implements "set var"). The mistaken
  `=` interpretation was also the root cause of RM100.CG's per-room-entry
  var-reset loop spinning forever (it relies on `work @= 0` to zero the var
  *addressed by* `work`, not `work` itself).
- **Automatic (y-based) priority now uses the real horizon and the real
  band range.** `render/sprites.ts` had its own stale `DEFAULT_HORIZON = 0`
  disconnected from `ObjectTable`'s real (and correct) `DEFAULT_HORIZON =
  36`, and nothing threaded a room's actual `set.horizon` value into the
  renderer - so automatic priority was always computed against the wrong
  horizon. Also corrected the band math to 5-14 (10 automatic bands); 15 is
  reserved for an explicit `set.priority(obj, 15)` override (several rooms,
  e.g. RM0.CG/RM10.CG, do exactly this for ego "to prevent hangups," which
  only makes sense if the automatic calculation can't already reach 15).
