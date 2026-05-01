import { type AutocompleteOptions, AutocompletePrompt } from '@clack/core';

interface OptionLike {
  value: unknown;
  label?: string;
  disabled?: boolean;
}

export interface PageableAutocompleteOptions<T extends OptionLike> extends AutocompleteOptions<T> {
  /**
   * Step size for PgUp/PgDn (and Home/End, which jump to the edges).
   * Defaults to 10. The CLI passes the prompt's `maxItems` so a page-step
   * matches the visible window.
   */
  readonly pageSize?: number;
}

/**
 * AutocompletePrompt with multi-row PgUp/PgDn navigation. Clack 1.2's
 * action set is hardcoded (up/down/left/right/space/enter/cancel), so
 * page navigation isn't a first-class action — but each up/down step
 * is a single mutation of the (private) cursor, dispatched via the
 * `'key'` event subscribers. We listen for pageup/pagedown/home/end
 * and synthesise the equivalent number of up/down `'key'` events;
 * clack's existing handler steps the cursor and re-renders for each.
 *
 * Home/End jump to the visible edges by emitting many steps in one
 * direction — clack wraps the cursor at the list boundary, so the
 * effective behavior is "go to top" / "go to bottom".
 */
export class PageableAutocompletePrompt<T extends OptionLike> extends AutocompletePrompt<T> {
  private readonly pageSize: number;

  constructor(opts: PageableAutocompleteOptions<T>) {
    super(opts);
    this.pageSize = Math.max(2, opts.pageSize ?? 10);

    this.on('key', (_char, key) => {
      if (!key) return;
      switch (key.name) {
        case 'pageup':
          this.stepBy('up', this.pageSize - 1);
          break;
        case 'pagedown':
          this.stepBy('down', this.pageSize - 1);
          break;
        case 'home':
          // Step a generous N — clack wraps; a few list-lengths is
          // plenty to settle at the top regardless of starting cursor.
          this.stepBy('up', this.filteredOptions.length);
          break;
        case 'end':
          this.stepBy('down', this.filteredOptions.length);
          break;
      }
    });
  }

  /**
   * Synthesises N additional `'key'` events of the given direction.
   * AutocompletePrompt's own subscriber handles each — moving the
   * private cursor and triggering the base Prompt's render pipeline.
   *
   * Bound to `this` so the subscriber chain re-enters cleanly; each
   * synthesised event is just another `'key'` emission, so the
   * pageup/pagedown branch above is gated to skip its own re-emissions
   * implicitly (the synthesised events have name 'up'/'down', not
   * 'pageup'/'pagedown').
   */
  private stepBy(direction: 'up' | 'down', count: number): void {
    for (let i = 0; i < count; i++) {
      // The Key shape clack expects has at least { name }. The other
      // fields readline normally fills (sequence, ctrl, meta, shift)
      // are unused by AutocompletePrompt's handler — only `name` is
      // read — so an empty stub is safe.
      this.emit('key', undefined, {
        name: direction,
        sequence: '',
        ctrl: false,
        meta: false,
        shift: false,
      });
    }
  }
}
