import { describe, expect, it } from 'vitest';
import type { AgiObject } from '../../src/resources/object';
import { VmState } from '../../src/vm/state';
import { clampSelection, getCarriedItems, indexForGridRow, itemAtIndex, layoutInventoryBox } from '../../src/render/inventory';

function makeObjects(...names: string[]): AgiObject[] {
  return names.map((name, id) => ({ id, name, startRoom: 0 }));
}

describe('getCarriedItems', () => {
  it('returns only the objects ego is currently carrying, in object-number order', () => {
    const objects = makeObjects('ego', 'chicken feather', 'cat hair', 'dog hair');
    const state = new VmState();
    state.takeObject(3);
    state.takeObject(1);

    expect(getCarriedItems(objects, state)).toEqual([objects[1], objects[3]]);
  });

  it('returns an empty list when nothing is carried', () => {
    const objects = makeObjects('ego', 'chicken feather');
    const state = new VmState();

    expect(getCarriedItems(objects, state)).toEqual([]);
  });

  it('excludes objects merely sitting in a room', () => {
    const objects = makeObjects('ego', 'chicken feather');
    const state = new VmState();
    state.dropObject(1, 34);

    expect(getCarriedItems(objects, state)).toEqual([]);
  });
});

describe('itemAtIndex', () => {
  const items = makeObjects('chicken feather', 'cat hair');

  it('resolves a valid cursor position to its item', () => {
    expect(itemAtIndex(items, 1)).toBe(items[1]);
  });

  it('returns undefined once the cursor runs past the end', () => {
    expect(itemAtIndex(items, 2)).toBeUndefined();
  });

  it('returns undefined for a negative index', () => {
    expect(itemAtIndex(items, -1)).toBeUndefined();
  });
});

describe('clampSelection', () => {
  it('keeps an in-range index unchanged', () => {
    expect(clampSelection(1, 3)).toBe(1);
  });

  it('clamps to the last item when the index runs past the end', () => {
    expect(clampSelection(5, 3)).toBe(2);
  });

  it('clamps to the first item when the index runs before the start', () => {
    expect(clampSelection(-2, 3)).toBe(0);
  });

  it('returns -1 (nothing to select) when the list is empty', () => {
    expect(clampSelection(0, 0)).toBe(-1);
  });
});

describe('layoutInventoryBox', () => {
  it('sizes the box to fit the longest item name plus a one-character margin on every side', () => {
    const box = layoutInventoryBox(['short', 'a much longer item name']);
    expect(box.width).toBe('a much longer item name'.length + 2);
    expect(box.height).toBe(2 + 2);
  });

  it('reserves a single placeholder line when nothing is carried', () => {
    const box = layoutInventoryBox([]);
    expect(box.height).toBe(1 + 2);
  });

  it('centers the box on the 40x25 grid', () => {
    const box = layoutInventoryBox(['abc']);
    expect(box.col).toBe(Math.floor((40 - box.width) / 2));
    expect(box.row).toBe(Math.floor((25 - box.height) / 2));
  });

  it('clamps box dimensions to the grid for a very long list of names', () => {
    const names = Array.from({ length: 40 }, (_, i) => `item ${i}`);
    const box = layoutInventoryBox(names);
    expect(box.height).toBeLessThanOrEqual(25);
  });
});

describe('indexForGridRow', () => {
  it('maps the first item row back to index 0', () => {
    const box = layoutInventoryBox(['a', 'b', 'c']);
    expect(indexForGridRow(box, 3, box.row + 1)).toBe(0);
  });

  it('maps subsequent rows to their matching index', () => {
    const box = layoutInventoryBox(['a', 'b', 'c']);
    expect(indexForGridRow(box, 3, box.row + 2)).toBe(1);
    expect(indexForGridRow(box, 3, box.row + 3)).toBe(2);
  });

  it('returns null for the border row above the list', () => {
    const box = layoutInventoryBox(['a', 'b', 'c']);
    expect(indexForGridRow(box, 3, box.row)).toBeNull();
  });

  it('returns null once past the last item, even inside the box', () => {
    const box = layoutInventoryBox(['a', 'b', 'c']);
    expect(indexForGridRow(box, 3, box.row + 4)).toBeNull();
  });

  it('returns null for rows entirely outside the box', () => {
    const box = layoutInventoryBox(['a', 'b', 'c']);
    expect(indexForGridRow(box, 3, box.row - 1)).toBeNull();
    expect(indexForGridRow(box, 3, box.row + 100)).toBeNull();
  });
});
