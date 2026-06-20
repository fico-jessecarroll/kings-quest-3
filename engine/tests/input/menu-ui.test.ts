import { describe, expect, it, vi } from 'vitest';
import { MenuUi } from '../../src/input/menu-ui';
import { VmState } from '../../src/vm/state';

const LABELS: Record<number, string> = {
  121: 'Sierra',
  122: 'About BC',
  123: 'Help',
  124: 'File',
  125: 'Save',
  126: 'Restore',
  127: '--------',
  128: 'Restart',
};
const resolveMessage = (n: number) => LABELS[n];

/** Builds a two-menu structure matching RM0.CG's Sierra/File layout, with one disabled separator item in File. */
function buildMenus(state: VmState): void {
  state.addMenu(121);
  state.addMenuItem(122, 27); // c.about
  state.addMenuItem(123, 2); // c.help

  state.addMenu(124);
  state.addMenuItem(125, 3); // c.save
  state.addMenuItem(126, 5); // c.restore
  state.addMenuItem(127, 29); // c.dummy (separator)
  state.setItemEnabled(29, false);
  state.addMenuItem(128, 7); // c.restart

  state.submitMenu();
}

describe('MenuUi: resolving the built menu structure', () => {
  it('reports no menus before submit.menu has run', () => {
    const state = new VmState();
    state.addMenu(121);
    state.addMenuItem(122, 27);

    const ui = new MenuUi({ state, resolveMessage });
    expect(ui.getMenus()).toEqual([]);
  });

  it('resolves message numbers to labels once submitted', () => {
    const state = new VmState();
    buildMenus(state);

    const ui = new MenuUi({ state, resolveMessage });
    expect(ui.getMenus()).toEqual([
      {
        label: 'Sierra',
        items: [
          { label: 'About BC', controller: 27, enabled: true },
          { label: 'Help', controller: 2, enabled: true },
        ],
      },
      {
        label: 'File',
        items: [
          { label: 'Save', controller: 3, enabled: true },
          { label: 'Restore', controller: 5, enabled: true },
          { label: '--------', controller: 29, enabled: false },
          { label: 'Restart', controller: 7, enabled: true },
        ],
      },
    ]);
  });

  it('falls back to a placeholder label for an unresolvable message number', () => {
    const state = new VmState();
    state.addMenu(999);
    state.addMenuItem(998, 1);
    state.submitMenu();

    const ui = new MenuUi({ state, resolveMessage });
    expect(ui.getMenus()[0].label).toBe('(message 999)');
    expect(ui.getMenus()[0].items[0].label).toBe('(message 998)');
  });
});

describe('MenuUi: open/close', () => {
  it('starts closed', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    expect(ui.isOpen()).toBe(false);
  });

  it('open() highlights the first menu and its first enabled item', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });

    ui.open();

    expect(ui.isOpen()).toBe(true);
    expect(ui.getMenuIndex()).toBe(0);
    expect(ui.getItemIndex()).toBe(0);
  });

  it('open() is a no-op when the menu has not been submitted', () => {
    const state = new VmState();
    state.addMenu(121);
    state.addMenuItem(122, 27);
    const ui = new MenuUi({ state, resolveMessage });

    ui.open();

    expect(ui.isOpen()).toBe(false);
  });

  it('open() is a no-op when there are no menus at all', () => {
    const state = new VmState();
    state.submitMenu();
    const ui = new MenuUi({ state, resolveMessage });

    ui.open();

    expect(ui.isOpen()).toBe(false);
  });

  it('close() and toggle() flip the open state', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });

    ui.toggle();
    expect(ui.isOpen()).toBe(true);
    ui.toggle();
    expect(ui.isOpen()).toBe(false);

    ui.open();
    ui.close();
    expect(ui.isOpen()).toBe(false);
  });

  it('close() while already closed does not notify onChange', () => {
    const state = new VmState();
    buildMenus(state);
    const onChange = vi.fn();
    const ui = new MenuUi({ state, resolveMessage, onChange });

    ui.close();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('open()/close() each notify onChange exactly once', () => {
    const state = new VmState();
    buildMenus(state);
    const onChange = vi.fn();
    const ui = new MenuUi({ state, resolveMessage, onChange });

    ui.open();
    expect(onChange).toHaveBeenCalledTimes(1);
    ui.close();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('MenuUi: navigation', () => {
  it('moveMenu cycles to the next/previous top-level menu, wrapping around', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open();

    ui.moveMenu(1);
    expect(ui.getMenuIndex()).toBe(1);
    ui.moveMenu(1);
    expect(ui.getMenuIndex()).toBe(0); // wraps
    ui.moveMenu(-1);
    expect(ui.getMenuIndex()).toBe(1); // wraps the other way
  });

  it('moveMenu re-highlights the first enabled item of the newly active menu', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open();
    ui.moveItem(1); // move off item 0 in Sierra

    ui.moveMenu(1); // switch to File

    expect(ui.getItemIndex()).toBe(0);
  });

  it('moveItem cycles within the current menu, wrapping around', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open(); // Sierra menu, 2 items

    ui.moveItem(1);
    expect(ui.getItemIndex()).toBe(1);
    ui.moveItem(1);
    expect(ui.getItemIndex()).toBe(0); // wraps
    ui.moveItem(-1);
    expect(ui.getItemIndex()).toBe(1);
  });

  it('moveItem skips disabled items', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open();
    ui.moveMenu(1); // File menu: Save(0), Restore(1), -------- disabled(2), Restart(3)

    ui.moveItem(1); // -> Restore (1)
    expect(ui.getItemIndex()).toBe(1);
    ui.moveItem(1); // -> would land on disabled separator, skip to Restart (3)
    expect(ui.getItemIndex()).toBe(3);
  });

  it('moveMenu/moveItem are no-ops while closed', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });

    ui.moveMenu(1);
    ui.moveItem(1);

    expect(ui.getMenuIndex()).toBe(0);
    expect(ui.getItemIndex()).toBe(0);
    expect(ui.isOpen()).toBe(false);
  });

  it('moveItem is a no-op when every item in the menu is disabled', () => {
    const state = new VmState();
    state.addMenu(121);
    state.addMenuItem(122, 27);
    state.setItemEnabled(27, false);
    state.submitMenu();
    const ui = new MenuUi({ state, resolveMessage });

    ui.open(); // can't land on an enabled item, but shouldn't throw
    ui.moveItem(1);

    expect(ui.getItemIndex()).toBe(0);
  });
});

describe('MenuUi: selection dispatches the controller event', () => {
  it('selectCurrent activates the highlighted item\'s controller and closes the menu', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open();
    ui.moveMenu(1); // File
    ui.moveItem(1); // Restore -> controller 5

    ui.selectCurrent();

    expect(state.isControllerActive(5)).toBe(true);
    expect(ui.isOpen()).toBe(false);
  });

  it('selectCurrent is a no-op while closed', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });

    ui.selectCurrent();

    expect(state.isControllerActive(27)).toBe(false);
  });

  it('selectCurrent never lands on a disabled item via normal navigation, so it always dispatches once open', () => {
    const state = new VmState();
    buildMenus(state);
    const ui = new MenuUi({ state, resolveMessage });
    ui.open();
    ui.moveMenu(1); // File: Save(0) Restore(1) --------(2,disabled) Restart(3)

    ui.moveItem(-1); // wraps backwards from Save -> Restart (skips disabled separator)
    expect(ui.getItemIndex()).toBe(3);

    ui.selectCurrent();
    expect(state.isControllerActive(7)).toBe(true); // c.restart
    expect(ui.isOpen()).toBe(false);
  });

  it('notifies onChange on every navigation step and on selection', () => {
    const state = new VmState();
    buildMenus(state);
    const onChange = vi.fn();
    const ui = new MenuUi({ state, resolveMessage, onChange });

    ui.open();
    ui.moveMenu(1);
    ui.moveItem(1);
    ui.selectCurrent();

    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
