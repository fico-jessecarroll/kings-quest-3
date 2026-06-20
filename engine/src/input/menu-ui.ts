/**
 * Drives the interactive AGI menu bar: resolves the structure game logic
 * built via `set.menu`/`set.menu.item` (`VmState.getMenus()`) into labelled
 * menus/items, tracks which menu/item is highlighted while open, and
 * dispatches the chosen item's controller through `VmState.selectMenuItem`
 * on selection - the same controller game logic polls for with
 * `controller(c.xxx)` after calling `menu.input()`.
 *
 * Pure logic, no DOM, mirroring `ParserUi`/`KeyboardInput` in this directory:
 * src/main.ts wires real keyboard events to open/move/select/close (and
 * renders the bar/dropdown as plain DOM, since that shell has no canvas
 * yet); src/viewer.ts's render demo wires the same events but renders
 * through drawMenuBar/drawMenuDropdown (render/text.ts) onto its canvas.
 */

import type { VmState } from '../vm/state';

export interface ResolvedMenuItem {
  label: string;
  controller: number;
  enabled: boolean;
}

export interface ResolvedMenu {
  label: string;
  items: ResolvedMenuItem[];
}

export interface MenuUiOptions {
  state: VmState;
  /** Resolves an AGI %message number to its text, for menu/item labels. */
  resolveMessage: (messageNumber: number) => string | undefined;
  /** Notified after open/close/navigation/selection changes anything, so the caller can redraw. */
  onChange?: () => void;
}

export class MenuUi {
  private readonly state: VmState;
  private readonly resolveMessage: (messageNumber: number) => string | undefined;
  private readonly onChange?: () => void;
  private openFlag = false;
  private menuIndex = 0;
  private itemIndex = 0;

  constructor(options: MenuUiOptions) {
    this.state = options.state;
    this.resolveMessage = options.resolveMessage;
    this.onChange = options.onChange;
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  getMenuIndex(): number {
    return this.menuIndex;
  }

  getItemIndex(): number {
    return this.itemIndex;
  }

  /** The built menu structure resolved to display labels, empty until `submit.menu()` has run. */
  getMenus(): ResolvedMenu[] {
    if (!this.state.isMenuSubmitted()) {
      return [];
    }
    return this.state.getMenus().map((menu) => ({
      label: this.label(menu.message),
      items: menu.items.map((item) => ({
        label: this.label(item.message),
        controller: item.controller,
        enabled: item.enabled,
      })),
    }));
  }

  private label(message: number): string {
    return this.resolveMessage(message) ?? `(message ${message})`;
  }

  /** Opens the menu bar at its first menu, highlighting its first enabled item. No-op if the menu hasn't been submitted or has no menus. */
  open(): void {
    const menus = this.getMenus();
    if (menus.length === 0) {
      return;
    }
    this.openFlag = true;
    this.menuIndex = 0;
    this.itemIndex = this.firstEnabledItemIndex(menus, this.menuIndex);
    this.onChange?.();
  }

  close(): void {
    if (!this.openFlag) {
      return;
    }
    this.openFlag = false;
    this.onChange?.();
  }

  toggle(): void {
    if (this.openFlag) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Moves the highlighted top-level menu left/right (pass -1/+1), wrapping around, and re-highlights that menu's first enabled item. No-op while closed. */
  moveMenu(delta: number): void {
    if (!this.openFlag) {
      return;
    }
    const menus = this.getMenus();
    this.menuIndex = (this.menuIndex + delta + menus.length) % menus.length;
    this.itemIndex = this.firstEnabledItemIndex(menus, this.menuIndex);
    this.onChange?.();
  }

  /** Moves the highlighted item up/down within the current menu (pass -1/+1), wrapping around and skipping disabled items. No-op while closed or if the menu has no enabled items. */
  moveItem(delta: number): void {
    if (!this.openFlag) {
      return;
    }
    const items = this.getMenus()[this.menuIndex]?.items ?? [];
    if (items.length === 0 || !items.some((item) => item.enabled)) {
      return;
    }
    let next = this.itemIndex;
    do {
      next = (next + delta + items.length) % items.length;
    } while (!items[next].enabled);
    this.itemIndex = next;
    this.onChange?.();
  }

  /** Dispatches the highlighted item's controller via `VmState.selectMenuItem` and closes the menu. Leaves the menu open (no dispatch) if the highlighted item turns out disabled or there's nothing highlighted. */
  selectCurrent(): void {
    if (!this.openFlag) {
      return;
    }
    const item = this.getMenus()[this.menuIndex]?.items[this.itemIndex];
    if (!item) {
      return;
    }
    if (this.state.selectMenuItem(item.controller)) {
      this.close();
    }
  }

  private firstEnabledItemIndex(menus: ResolvedMenu[], menuIndex: number): number {
    const items = menus[menuIndex]?.items ?? [];
    const index = items.findIndex((item) => item.enabled);
    return index === -1 ? 0 : index;
  }
}
