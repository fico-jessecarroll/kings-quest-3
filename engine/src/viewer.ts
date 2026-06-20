// Standalone asset-viewer page. Loads the real KQ3 assets over fetch and
// exercises every binary decoder in src/resources against real data, with
// no gameplay logic involved.

import { decodePic, renderToCanvas } from './resources/pic';
import { decodeObjectFile, type ObjectTable } from './resources/object';
import { decodeWords } from './resources/words';
import { decodeSound, playSound, type DecodedSound } from './resources/sound';
import { Interpreter } from './vm/interpreter';
import { VmState } from './vm/state';
import { SoundController } from './vm/soundController';
import type { CallNode, Logic } from './logic/ir';
import { renderFrame } from './render/frame';
import { clampSelection, getCarriedItems, itemAtIndex } from './render/inventory';
import { drawMenuBar } from './render/text';
import { sizeScreenCanvas } from './render/screen';

// AGI resource numbers are a single byte (0-255); probing the whole range
// over fetch and keeping only the ones that resolve is simpler and more
// robust than hard-coding which numbers this game ships.
const MAX_RESOURCE_ID = 255;

interface FetchedResource {
  id: number;
  bytes: Uint8Array;
}

async function fetchResourceRange(dir: string, max: number): Promise<FetchedResource[]> {
  const ids = Array.from({ length: max + 1 }, (_, i) => i);
  const results = await Promise.all(
    ids.map(async (id): Promise<FetchedResource | null> => {
      const res = await fetch(`/${dir}/${dir}.${id}`);
      if (!res.ok) return null;
      return { id, bytes: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
  return results
    .filter((r): r is FetchedResource => r !== null)
    .sort((a, b) => a.id - b.id);
}

function setStatus(elementId: string, message: string): void {
  const el = document.getElementById(elementId);
  if (el) el.textContent = message;
}

async function loadPics(): Promise<void> {
  const gallery = document.getElementById('pic-gallery');
  if (!gallery) return;

  setStatus('pic-status', 'Loading...');
  const resources = await fetchResourceRange('PIC', MAX_RESOURCE_ID);

  let decoded = 0;
  let failed = 0;
  for (const { id, bytes } of resources) {
    try {
      const { visual } = decodePic(bytes);
      const canvas = document.createElement('canvas');
      renderToCanvas(visual, canvas);

      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption');
      caption.textContent = `PIC.${id}`;
      figure.append(canvas, caption);
      gallery.append(figure);
      decoded++;
    } catch (err) {
      failed++;
      console.error(`Failed to decode PIC.${id}`, err);
    }
  }

  setStatus('pic-status', `${decoded} pictures decoded${failed > 0 ? `, ${failed} failed` : ''} (out of ${resources.length} found).`);
}

// Shared across loadObjects() and setupRenderDemo() so the OBJECT resource
// is only fetched and decoded once, even though both sections need it.
let objectTablePromise: Promise<ObjectTable> | null = null;
function loadObjectTable(): Promise<ObjectTable> {
  objectTablePromise ??= (async () => {
    const res = await fetch('/OBJECT');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return decodeObjectFile(bytes);
  })();
  return objectTablePromise;
}

async function loadObjects(): Promise<void> {
  const tbody = document.querySelector('#object-table tbody');
  if (!tbody) return;

  setStatus('object-status', 'Loading...');
  try {
    const table = await loadObjectTable();

    for (const obj of table.objects) {
      const row = document.createElement('tr');
      const idCell = document.createElement('td');
      idCell.textContent = String(obj.id);
      const nameCell = document.createElement('td');
      nameCell.textContent = obj.name;
      const roomCell = document.createElement('td');
      roomCell.textContent = String(obj.startRoom);
      row.append(idCell, nameCell, roomCell);
      tbody.append(row);
    }

    setStatus('object-status', `${table.objects.length} objects decoded (max animated: ${table.maxAnimatedObjects}).`);
  } catch (err) {
    setStatus('object-status', `Failed to load OBJECT: ${String(err)}`);
    console.error(err);
  }
}

async function loadWords(): Promise<void> {
  const container = document.getElementById('word-groups');
  if (!container) return;

  setStatus('words-status', 'Loading...');
  try {
    const res = await fetch('/WORDS.TOK');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { words, groups } = decodeWords(bytes);

    const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a - b);
    for (const [group, groupWords] of sortedGroups) {
      const line = document.createElement('div');
      line.textContent = `${group}: ${groupWords.slice().sort().join(', ')}`;
      container.append(line);
    }

    setStatus('words-status', `${words.size} words decoded in ${groups.size} groups.`);
  } catch (err) {
    setStatus('words-status', `Failed to load WORDS.TOK: ${String(err)}`);
    console.error(err);
  }
}

let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  sharedAudioContext ??= new AudioContext();
  return sharedAudioContext;
}

async function loadSounds(): Promise<void> {
  const list = document.getElementById('sound-list');
  if (!list) return;

  setStatus('sound-status', 'Loading...');
  const resources = await fetchResourceRange('SND', MAX_RESOURCE_ID);

  // Decode lazily on click: building 4 oscillator/audio-graph nodes ahead of
  // time for every sound serves no purpose if it's never played.
  const decodedCache = new Map<number, DecodedSound>();

  for (const { id, bytes } of resources) {
    const button = document.createElement('button');
    button.textContent = `Play SND.${id}`;
    button.addEventListener('click', () => {
      try {
        let sound = decodedCache.get(id);
        if (!sound) {
          sound = decodeSound(bytes);
          decodedCache.set(id, sound);
        }
        playSound(getAudioContext(), sound);
      } catch (err) {
        setStatus('sound-status', `Failed to play SND.${id}: ${String(err)}`);
        console.error(err);
      }
    });
    list.append(button);
  }

  setStatus('sound-status', `${resources.length} sounds available.`);
}

// Flag 41 is SRC/GAMEDEFS.H's `done` - the flag most room logics pass to
// sound() to learn when playback finished.
const SOUND_DONE_FLAG = 41;

/**
 * Exercises the VM `sound`/`load.sound`/`stop.sound` commands end-to-end -
 * Interpreter -> SoundController -> playSound() -> Web Audio - rather than
 * calling the decoder/player directly like loadSounds() above. This is the
 * manual check that room music/effects actually play through the same path
 * game logic uses, including the sound-enabled toggle and completion flag.
 */
async function setupVmSoundDemo(): Promise<void> {
  const list = document.getElementById('vm-sound-list');
  const enabledToggle = document.getElementById('vm-sound-enabled') as HTMLInputElement | null;
  if (!list) return;

  setStatus('vm-sound-status', 'Loading...');
  const resources = await fetchResourceRange('SND', MAX_RESOURCE_ID);
  const rawById = new Map(resources.map(({ id, bytes }) => [id, bytes]));

  const state = new VmState();
  const soundController = new SoundController({
    state,
    audioContext: getAudioContext(),
    soundLoader: (id) => rawById.get(id),
  });
  const interpreter = new Interpreter({ state, commands: soundController.commands });

  enabledToggle?.addEventListener('change', () => {
    state.setSoundEnabled(enabledToggle.checked);
  });

  function runCommand(name: string, args: CallNode['args']): void {
    const logic: Logic = { statements: [{ type: 'call', name, args }] };
    interpreter.loadLogic(900, logic);
    interpreter.runLogic(900);
  }

  for (const { id } of resources) {
    const row = document.createElement('div');

    const playButton = document.createElement('button');
    playButton.textContent = `sound( ${id}, done )`;
    const flagLabel = document.createElement('span');

    let pollHandle: ReturnType<typeof setTimeout> | undefined;
    const renderFlag = (): void => {
      flagLabel.textContent = ` done: ${state.getFlag(SOUND_DONE_FLAG)}`;
    };
    const pollUntilDone = (): void => {
      renderFlag();
      if (!state.getFlag(SOUND_DONE_FLAG)) {
        pollHandle = setTimeout(pollUntilDone, 200);
      }
    };

    playButton.addEventListener('click', () => {
      clearTimeout(pollHandle);
      state.resetFlag(SOUND_DONE_FLAG);
      runCommand('load.sound', [{ kind: 'number', value: id }]);
      runCommand('sound', [
        { kind: 'number', value: id },
        { kind: 'number', value: SOUND_DONE_FLAG },
      ]);
      pollUntilDone();
    });

    const stopButton = document.createElement('button');
    stopButton.textContent = 'stop.sound()';
    stopButton.addEventListener('click', () => runCommand('stop.sound', []));

    row.append(playButton, stopButton, flagLabel);
    list.append(row);
  }

  setStatus(
    'vm-sound-status',
    `${resources.length} sounds wired through the VM sound/load.sound/stop.sound commands. Toggle "sound enabled" to confirm the done flag still fires immediately with audio off.`,
  );
}

// Demo messages keyed the same way a logic's %message table would be -
// resolveMessage below stands in for the real logic-message lookup, which
// isn't wired up yet.
const RENDER_DEMO_MESSAGES: Record<number, string> = {
  1: "Welcome to the placeholder renderer! This long line exercises text.ts's word wrap inside a print() message window.",
  2: 'A shorter print.at() window, anchored at a specific row and column.',
  3: 'HP: 10',
};

/**
 * Exercises screen.ts/sprites.ts/text.ts together against a real decoded
 * PIC: blits the background, draws placeholder priority-coloured boxes for
 * ego and two animated objects (no VIEW assets exist yet), and lets the
 * status line/message windows/menu bar be toggled on demand. This is the
 * manual smoke test called out in the screen-renderer story, since none of
 * the canvas drawing itself is unit tested.
 */
async function setupRenderDemo(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  setStatus('render-status', 'Loading...');
  let visualBytes: Uint8Array;
  let objectTable: ObjectTable;
  try {
    const res = await fetch('/PIC/PIC.1');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    visualBytes = new Uint8Array(await res.arrayBuffer());
    objectTable = await loadObjectTable();
  } catch (err) {
    setStatus('render-status', `Failed to load PIC.1 or OBJECT: ${String(err)}`);
    console.error(err);
    return;
  }

  sizeScreenCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const state = new VmState();
  state.setPictureBuffers(decodePic(visualBytes));
  state.setPictureVisible(true);
  state.setScore(12);
  state.setMaxScore(100);

  // Ego plus two animated objects at different depths, so their placeholder
  // boxes land at visibly different priority colours/y positions.
  state.setPosition(0, 76, 150); // ego, automatic priority (near the bottom -> high band)
  state.setPosition(1, 30, 40);
  state.setPriority(1, 6); // fixed priority, far away
  state.setPosition(2, 120, 100); // automatic priority, mid-screen

  // Carry a couple of inventory items so the status()/show.obj() demo
  // buttons below have something real to list and pick from.
  state.takeObject(1); // Chicken Feather*
  state.takeObject(2); // Cat Hair*

  let menuOpen = false;
  let selectionIndex = 0;

  function redraw(): void {
    if (!ctx) return;
    renderFrame(ctx, state, {
      spriteObjectNumbers: [0, 1, 2],
      resolveMessage: (n) => RENDER_DEMO_MESSAGES[n],
      objects: objectTable.objects,
      inventorySelection: selectionIndex,
    });
    if (menuOpen) {
      drawMenuBar(ctx, ['File', 'Game', 'Sound', 'Speed']);
    }
  }

  document.getElementById('render-print')?.addEventListener('click', () => {
    state.setDisplay({ kind: 'print', message: 1 });
    redraw();
  });
  document.getElementById('render-print-at')?.addEventListener('click', () => {
    state.setDisplay({ kind: 'print.at', message: 2, row: 10, col: 5, width: 20 });
    redraw();
  });
  document.getElementById('render-display')?.addEventListener('click', () => {
    state.setDisplay({ kind: 'display', message: 3, row: 24, col: 2 });
    redraw();
  });
  document.getElementById('render-menu')?.addEventListener('click', () => {
    menuOpen = !menuOpen;
    redraw();
  });
  document.getElementById('render-inventory')?.addEventListener('click', () => {
    const items = getCarriedItems(objectTable.objects, state);
    selectionIndex = clampSelection(selectionIndex, items.length);
    state.setDisplay({ kind: 'status' });
    redraw();
  });
  document.getElementById('render-inventory-prev')?.addEventListener('click', () => {
    const items = getCarriedItems(objectTable.objects, state);
    selectionIndex = clampSelection(selectionIndex - 1, items.length);
    redraw();
  });
  document.getElementById('render-inventory-next')?.addEventListener('click', () => {
    const items = getCarriedItems(objectTable.objects, state);
    selectionIndex = clampSelection(selectionIndex + 1, items.length);
    redraw();
  });
  document.getElementById('render-show-obj')?.addEventListener('click', () => {
    const items = getCarriedItems(objectTable.objects, state);
    const item = itemAtIndex(items, selectionIndex);
    if (item) {
      state.setDisplay({ kind: 'show.obj', object: item.id });
      redraw();
    }
  });

  redraw();
  setStatus(
    'render-status',
    'Rendered PIC.1 with placeholder sprites. Use the buttons above to exercise text.ts, plus status()/show.obj() carrying the Chicken Feather and Cat Hair.',
  );
}

void loadPics();
void loadObjects();
void loadWords();
void loadSounds();
void setupVmSoundDemo();
void setupRenderDemo();
