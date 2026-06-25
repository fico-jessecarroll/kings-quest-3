# King's Quest III — AGI Engine

A from-scratch browser-based interpreter for *King's Quest III: To Heir is Human* (Sierra On-Line, 1986),
built directly against this repo's original AGI v2 game sources (`SRC/*.CG` logic scripts,
`PIC`/`SND`/`OBJECT`/`WORDS.TOK` resources) — no emulator, no original interpreter binary.

The game runs entirely in the browser via a TypeScript VM that compiles and executes the original
AGI bytecode, renders vector pictures, plays PCjr/Tandy sound through the Web Audio API, handles
the text parser, and drives a fixed-rate game loop through requestAnimationFrame.

---

## Prerequisites

- **Node.js 18+** (v22 recommended — the version this was developed on)
- **npm** (bundled with Node)

No other tools or runtimes are needed.

---

## Quick start

```sh
cd engine
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. That's it.

> `npm run dev` runs `build:logic` first automatically (via the `predev` script), which compiles
> the 124 original `.CG` logic scripts into `src/generated/logic-bundle.json`. This takes a few
> seconds on first run; subsequent runs are fast.

---

## Build / run commands

All commands run from the `engine/` directory.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (Vite, Vitest, TypeScript, tsx) |
| `npm run dev` | Compile logic + start the Vite dev server at `localhost:5173` |
| `npm run build` | Compile logic + build a production bundle into `engine/dist/` |
| `npm run build:logic` | Compile only the `.CG` logic scripts (fast, outputs to `src/generated/`) |
| `npm test` | Run the full test suite (687 tests, ~2s) |
| `npm run discover-gaps` | Boot all 124 rooms headlessly and report unimplemented commands/tests |

---

## How to play

The game runs in the browser at **http://localhost:5173** after `npm run dev`.

**Controls:**

| Input | Action |
|---|---|
| Arrow keys | Move Manannan's apprentice (ego) |
| Type + Enter | Submit a text parser command (e.g. `look`, `get broom`, `go north`) |
| Esc | Clear the parser input |
| F1–F10 / Fn keys | AGI function keys (help, save, restore, etc.) |
| Alt | Open the menu bar |

**Tips:**
- The parser understands two-word commands in the style of classic Sierra adventures: `get [object]`, `look [object]`, `go [direction]`, `use [object]`, etc.
- Use `look` with no argument to examine your surroundings.
- Room transitions happen by walking off the edge of the screen in the appropriate direction.

---

## Asset viewer

A separate tool for inspecting individual game assets is served at **http://localhost:5173/viewer.html**.
It lets you step through every `PIC` vector picture, play `SND` sound resources, inspect the
`OBJECT` inventory table, and browse the `WORDS.TOK` vocabulary — all without running the
interpreter.

---

## Project structure

```
kings-quest-3/
├── SRC/          Original AGI v2 logic source files (124 room .CG scripts + shared headers)
├── PIC/          Vector picture resources (111 rooms)
├── SND/          Sound resources (39 tracks)
├── OBJECT        Inventory object table
├── WORDS.TOK     Vocabulary / parser word list
└── engine/       TypeScript engine (the interpreter, renderer, and dev tooling)
    ├── src/
    │   ├── main.ts          Entry point — boots the game
    │   ├── game/
    │   │   ├── engine.ts    Conductor: assembles VM + commands + renderer into one unit
    │   │   ├── loop.ts      requestAnimationFrame-backed fixed-rate game loop
    │   │   └── resources.ts Async asset loader (logic bundle, OBJECT, WORDS, PIC)
    │   ├── vm/
    │   │   ├── interpreter.ts  AGI cycle engine (logic 0 → current room each tick)
    │   │   ├── state.ts        VmState — flags, vars, strings, controller bits
    │   │   ├── objects.ts      ObjectTable — animated objects, motion, priority
    │   │   ├── commands.ts     Core AGI command implementations
    │   │   ├── objectCommands.ts  Object/motion commands (move.obj, follow.ego, …)
    │   │   ├── soundController.ts Web Audio sound playback
    │   │   └── save.ts         Save/restore via localStorage
    │   ├── input/
    │   │   ├── keyboard.ts    Arrow-key → ego direction, function keys, controller bits
    │   │   ├── parser-ui.ts   Text parser input → VmState
    │   │   └── menu-ui.ts     AGI menu bar (Game / Speed / Sound / Help menus)
    │   ├── render/
    │   │   ├── frame.ts       Full-frame renderer (picture + sprites + text windows)
    │   │   └── screen.ts      Canvas sizing / AGI 160×168 coordinate mapping
    │   ├── resources/
    │   │   ├── picture.ts     AGI PIC vector decoder
    │   │   ├── words.ts       WORDS.TOK vocabulary decoder
    │   │   ├── object.ts      OBJECT inventory table decoder
    │   │   └── sound.ts       AGI SND decoder + PCjr/Tandy synthesis
    │   ├── logic/
    │   │   └── preprocess.ts  CG preprocessor (includes, defines, macros)
    │   └── generated/         Build output — gitignored, produced by build:logic
    │       ├── logic-bundle.json
    │       ├── symbols.json
    │       └── messages.json
    ├── tools/
    │   ├── compile-logic.ts   Compiles all SRC/*.CG → src/generated/
    │   └── discover-gaps.ts   Headless gap reporter for all 124 room logics
    ├── tests/                 Vitest test suite (687 tests)
    └── viewer.html            Standalone asset inspector
```

---

## How it works

The engine is a faithful reimplementation of Sierra's AGI v2 interpreter:

1. **Logic compilation** (`build:logic`): `tools/compile-logic.ts` preprocesses and compiles all
   124 `SRC/RM*.CG` scripts through the CG macro language (includes, `%define`/`#define`,
   conditional blocks) into a JSON bundle of AGI bytecode IR that the VM executes at runtime.

2. **VM**: `vm/interpreter.ts` runs AGI's two-phase cycle — logic 0 (always), then the current
   room's logic — each tick. Every AGI command and test (`if`/`else`, `new.room`, `move.obj`,
   `said`, `print`, `draw.pic`, `play.sound`, …) is implemented as a plain TypeScript function
   dispatched by opcode. `vm/state.ts` owns the 256 flags, 256 vars, and 24 strings that are
   the entire AGI runtime state.

3. **Rendering**: `render/frame.ts` decodes `PIC` vector graphics (fill, line, pen draws in
   the visual and priority buffers) and composites animated objects on top, driven purely from
   `VmState` — no intermediate scene graph.

4. **Input**: `input/keyboard.ts` maps held arrow keys to `ReservedVar.EgoDirection` each
   cycle; `input/parser-ui.ts` feeds typed text through `vm/tests.ts`'s `said()` matcher;
   `input/menu-ui.ts` renders and handles the AGI pull-down menu bar.

5. **Game loop**: `game/loop.ts` drives the cycle at the rate set by `ReservedVar.TimeDelay`
   (AGI var 10) via `requestAnimationFrame` with a cycle accumulator, matching the original
   ~20 cycles/sec base rate.

---

## Known limitations

These are deliberate, documented gaps rather than bugs. See `engine/README.md` for the full list.

- **No VIEW resources, so no real sprites.** The repo's asset dump has `PIC`/`SND`/`OBJECT`/
  `WORDS.TOK` but no `VIEW` directory; animated objects are drawn as coloured priority-band boxes
  instead of real AGI view/loop/cel bitmaps. Positions, motion, and priority are fully real.
- **`set.speed` menu items are inert.** The Speed menu exists and is selectable but is not wired
  to a cycle-skipping mechanism; the loop runs at a fixed ~20 cycles/sec.
- **Indirect-addressing in `draw.pic` arguments for rooms 99 and 100.** A narrow
  immediate-vs-variable encoding edge case; only the background picture fails to load in those
  two rooms — all other logic, objects, and events are unaffected.

---

## Development

```sh
# Run the test suite
cd engine && npm test

# Headless gap report across all 124 rooms
cd engine && npm run discover-gaps

# Type-check without emitting
cd engine && npx tsc --noEmit
```

The test suite covers the VM (interpreter, state, objects), resource decoders (PIC, SND,
WORDS.TOK, OBJECT), the logic compiler, and a headless integration pass over all 124 rooms
that asserts zero unresolved symbols.
