import type { Readable, Writable } from 'node:stream';
import {
  S_BAR,
  S_BAR_END,
  S_BAR_START,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  S_STEP_CANCEL,
  S_STEP_ERROR,
  S_STEP_SUBMIT,
  isCancel as clackIsCancel,
} from '@clack/prompts';
import pc from 'picocolors';
import { visualWidth } from './log';
import { PageableAutocompletePrompt } from './pageable-prompt';
import { clipAnsiToWidth } from './width';

export interface PickerOption<Value> {
  value: Value;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

export interface PickerOptions<Value> {
  message: string;
  options: PickerOption<Value>[];
  initialValues?: readonly Value[];
  required?: boolean;
  /** Visible-window size; also used as the page-step for PgUp/PgDn. */
  maxItems?: number;
  /**
   * Streams to drive the prompt with. Default to the real terminal;
   * tests pass mocks to exercise the prompt without a TTY.
   */
  input?: Readable;
  output?: Writable;
}

// Forwards only the streams the caller actually set, so clack keeps its
// own process.stdin/stdout defaults when they're absent.
function streamOpts(opts: {
  input?: Readable;
  output?: Writable;
}): { input?: Readable; output?: Writable } {
  return {
    ...(opts.input ? { input: opts.input } : {}),
    ...(opts.output ? { output: opts.output } : {}),
  };
}

// The width of the stream the prompt actually renders into: the injected
// output's columns when the caller passed one (tests), else the real
// terminal's.
function termColumns(output: Writable | undefined): number {
  const cols = output && 'columns' in output ? (output as { columns?: number }).columns : undefined;
  return cols ?? process.stdout.columns ?? 80;
}

const opt = (
  option: PickerOption<unknown>,
  state: 'inactive' | 'active' | 'selected' | 'active-selected' | 'submitted' | 'cancelled',
): string => {
  const label = option.label ?? String(option.value);
  const isDisabled = option.disabled === true;
  const hintFragment = option.hint ? `  ${pc.dim(`(${option.hint})`)}` : '';

  switch (state) {
    case 'submitted':
      return pc.dim(label);
    case 'cancelled':
      return pc.strikethrough(pc.dim(label));
    case 'active':
      return `${pc.green(S_CHECKBOX_ACTIVE)} ${isDisabled ? pc.dim(label) : label}${hintFragment}`;
    case 'selected':
      return `${pc.green(S_CHECKBOX_SELECTED)} ${pc.dim(label)}${hintFragment}`;
    case 'active-selected':
      return `${pc.green(S_CHECKBOX_SELECTED)} ${isDisabled ? pc.dim(label) : label}${hintFragment}`;
    default:
      return `${pc.dim(S_CHECKBOX_INACTIVE)} ${pc.dim(label)}${hintFragment}`;
  }
};

const radioOpt = (
  option: PickerOption<unknown>,
  state: 'inactive' | 'active' | 'submitted' | 'cancelled',
): string => {
  const label = option.label ?? String(option.value);
  const hintFragment = option.hint ? `  ${pc.dim(`(${option.hint})`)}` : '';
  switch (state) {
    case 'submitted':
      return pc.dim(label);
    case 'cancelled':
      return pc.strikethrough(pc.dim(label));
    case 'active':
      return `${pc.green(S_RADIO_ACTIVE)} ${label}${hintFragment}`;
    default:
      return `${pc.dim(S_RADIO_INACTIVE)} ${pc.dim(label)}${hintFragment}`;
  }
};

interface GridLayout {
  /** Number of columns in the rendered grid. ≥1. */
  cols: number;
  /** Rows per column (the visible row count regardless of `cols`). */
  rowsPerCol: number;
  /** Total visible items per page = cols × rowsPerCol. */
  pageItems: number;
  /** Cell budget for one rendered row; rows are clipped to this so they never wrap. */
  maxRowWidth: number;
}

/**
 * Computes a column-major grid layout sized to fit the terminal width.
 * Each column is wide enough for the longest visible label plus a
 * separator. Falls back to single-column when the terminal is too
 * narrow for any 2-column layout.
 */
function gridLayout(
  options: ReadonlyArray<PickerOption<unknown>>,
  rowsPerCol: number,
  termWidth: number,
): GridLayout {
  // Width budget: terminal minus prompt frame ("│  " ≈ 3) and a small
  // safety margin. Column separator costs 2 spaces between columns.
  const usable = Math.max(20, termWidth - 4);
  if (options.length === 0) {
    return { cols: 1, rowsPerCol, pageItems: rowsPerCol, maxRowWidth: usable };
  }
  const colSep = 2;
  // Use the inactive-state rendered width — every column slot has the
  // same glyph + space + label structure, so this is the worst case
  // for any state the row might land in during navigation.
  const widest = Math.max(...options.map((o) => visualWidth(opt(o, 'inactive'))), 20);
  const cols = Math.max(1, Math.floor((usable + colSep) / (widest + colSep)));
  return { cols, rowsPerCol, pageItems: cols * rowsPerCol, maxRowWidth: usable };
}

/**
 * Renders the visible page (`cols × rowsPerCol` items) as a column-major
 * grid: items fill column 1 top-to-bottom, then column 2, then column 3.
 * That matches the user's expectation that ↓ moves visually down — the
 * underlying 1D cursor `+= 1` move walks down a column, and at the
 * column foot wraps to the top of the next column.
 *
 * Returns one rendered line per visible row, NOT including the prompt
 * frame (caller prepends `│  `).
 */
function renderColumnGrid<Value>(
  filtered: ReadonlyArray<PickerOption<Value>>,
  cursor: number,
  layout: GridLayout,
  styled: (option: PickerOption<Value>, active: boolean) => string,
): string[] {
  const { cols, rowsPerCol, pageItems } = layout;
  const page = Math.floor(cursor / pageItems);
  const start = page * pageItems;
  const end = Math.min(start + pageItems, filtered.length);
  const visible = filtered.slice(start, end);

  // Rendered cells indexed by column-major position within the page.
  const cells: string[] = visible.map((o, i) => styled(o, start + i === cursor));

  // Per-column widths so cells in the same column align.
  const colWidths: number[] = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rowsPerCol; r++) {
      const i = c * rowsPerCol + r;
      if (i >= cells.length) break;
      const width = visualWidth(cells[i] ?? '');
      if (width > (colWidths[c] ?? 0)) colWidths[c] = width;
    }
  }

  const rows: string[] = [];
  for (let r = 0; r < rowsPerCol; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      const i = c * rowsPerCol + r;
      if (i >= cells.length) break;
      parts.push(cells[i] ?? '');
    }
    if (parts.length === 0) continue;
    // Pad every cell except the row's last — padding only exists to align
    // the NEXT column, and padding the final cell to the widest label can
    // push short rows past the terminal edge, wrapping each one into a
    // phantom blank line. Then clip: one over-long label would otherwise
    // wrap and throw off clack's line accounting when it redraws.
    const row = parts
      .map((cell, c) =>
        c < parts.length - 1
          ? cell + ' '.repeat(Math.max(0, (colWidths[c] ?? 0) - visualWidth(cell)))
          : cell,
      )
      .join('  ');
    rows.push(clipAnsiToWidth(row, layout.maxRowWidth));
  }
  return rows;
}

/**
 * Pageable multi-select prompt with optional multi-column layout.
 *
 * Adds these on top of clack's stock `autocompleteMultiselect`:
 *   - Multi-column grid (column-major) sized to fit the terminal width;
 *     1D cursor moves naturally walk down one column and wrap into the
 *     next, matching arrow-key intuition.
 *   - PgUp / PgDn step by one full page (cols × rowsPerCol items).
 *   - Home / End jump to the start / end of the filtered list.
 *   - Page indicator `(page A/B)` rendered when the list spans multiple
 *     pages.
 *   - Dim help footer below the option list.
 *
 * Typing-to-filter works via the underlying AutocompletePrompt's
 * `userInput` plumbing, unchanged from clack's stock prompt.
 */
export async function pageableAutocompleteMultiselect<Value>(
  opts: PickerOptions<Value>,
): Promise<readonly Value[] | symbol> {
  const required = opts.required ?? true;
  const rowsPerCol = opts.maxItems ?? 10;
  // Mutable holder so the pageStep callback can read the latest layout
  // computed in render(). render() runs before any keypress, so by the
  // time PgUp/PgDn fires, this is populated.
  let layout: GridLayout = { cols: 1, rowsPerCol, pageItems: rowsPerCol, maxRowWidth: 76 };

  // clack tracks selection as VALUES, not options (see the submit render
  // and the return below), so rendering a picked row's label means
  // resolving the value back to its option.
  const byValue = new Map(opts.options.map((o) => [o.value, o]));
  const toOption = (value: Value): PickerOption<Value> => byValue.get(value) ?? { value };

  const prompt: PageableAutocompletePrompt<PickerOption<Value>> = new PageableAutocompletePrompt<
    PickerOption<Value>
  >({
    options: opts.options,
    multiple: true,
    initialValue: opts.initialValues ? [...opts.initialValues] : undefined,
    pageStep: () => layout.pageItems,
    ...streamOpts(opts),
    validate(value) {
      if (required && (value === undefined || (Array.isArray(value) && value.length === 0))) {
        return `Please select at least one option.\n${pc.reset(
          pc.dim(
            `Press ${pc.gray(pc.bgWhite(pc.inverse(' space ')))} to select, ${pc.gray(
              pc.bgWhite(pc.inverse(' enter ')),
            )} to submit`,
          ),
        )}`;
      }
      return undefined;
    },
    render(this: PageableAutocompletePrompt<PickerOption<Value>>) {
      // Recompute layout each render so terminal resizes and filter
      // changes (which alter the visible widest label) take effect.
      layout = gridLayout(this.filteredOptions, rowsPerCol, termColumns(opts.output));

      const titleLine = `${pc.gray(S_BAR)}\n${getStepSymbol(this.state)}  ${opts.message}${pageIndicator(
        this.cursor,
        this.filteredOptions.length,
        layout.pageItems,
      )}\n`;

      const filterLine = renderFilterLine(this.userInputWithCursor);

      // Cancellation / submission render: collapse to the picked rows
      // (or strikethrough on cancel), matching clack's stock behavior.
      if (this.state === 'submit' || this.state === 'cancel') {
        const picked = this.selectedValues.map(toOption);
        const rows = picked
          .map((o) => opt(o, this.state === 'submit' ? 'submitted' : 'cancelled'))
          .join(pc.dim(', '));
        if (this.state === 'submit') {
          return `${titleLine}${pc.gray(S_BAR)}  ${picked.length > 0 ? rows : pc.dim('(none)')}`;
        }
        // Cancelling with nothing picked leaves no row to strike through,
        // so the trailing bar would frame an empty line.
        return `${titleLine}${pc.gray(S_BAR)}  ${
          picked.length > 0 ? `${rows}\n${pc.gray(S_BAR)}` : ''
        }`;
      }

      // Active render: filter input + visible grid of options.
      const styled = (option: PickerOption<Value>, active: boolean): string => {
        const isSelected = (this.selectedValues as Value[]).includes(option.value as Value);
        if (active && isSelected) return opt(option, 'active-selected');
        if (active) return opt(option, 'active');
        if (isSelected) return opt(option, 'selected');
        return opt(option, 'inactive');
      };

      const body =
        this.filteredOptions.length === 0
          ? `${pc.gray(S_BAR)}  ${pc.dim('No matches.')}`
          : renderColumnGrid(this.filteredOptions, this.cursor, layout, styled)
              .map((line) => `${pc.gray(S_BAR)}  ${line}`)
              .join('\n');

      const footer = renderHelpFooter(layout.maxRowWidth);

      const errorLine = this.error ? `\n${pc.yellow(S_BAR_END)}  ${pc.yellow(this.error)}` : '';

      return `${titleLine}${filterLine}\n${body}\n${footer}${errorLine}`;
    },
  });

  const resolved = await prompt.prompt();
  if (clackIsCancel(resolved)) return resolved;
  // `multiple: true` resolves to the selected VALUES, not the option
  // objects — AutocompletePrompt extends Prompt<T['value'] | T['value'][]>
  // and submit assigns from `selectedValues`. Reading `.value` off these
  // yields undefined, which the ConfigStore then writes as a YAML null.
  return (resolved as Value[] | undefined) ?? [];
}

/**
 * Single-pick variant for symmetry / future use. Not yet wired into the
 * CLI — the existing `select` from clack handles the target prompt fine.
 * Exported for potential use by a future "pick one outdated" flow.
 */
export async function pageableSelect<Value>(
  opts: Omit<PickerOptions<Value>, 'initialValues'> & { initialValue?: Value },
): Promise<Value | symbol> {
  const rowsPerCol = opts.maxItems ?? 10;
  let layout: GridLayout = { cols: 1, rowsPerCol, pageItems: rowsPerCol, maxRowWidth: 76 };

  const prompt: PageableAutocompletePrompt<PickerOption<Value>> = new PageableAutocompletePrompt<
    PickerOption<Value>
  >({
    options: opts.options,
    multiple: false,
    initialValue: opts.initialValue !== undefined ? [opts.initialValue] : undefined,
    pageStep: () => layout.pageItems,
    ...streamOpts(opts),
    render(this: PageableAutocompletePrompt<PickerOption<Value>>) {
      layout = gridLayout(this.filteredOptions, rowsPerCol, termColumns(opts.output));

      const titleLine = `${pc.gray(S_BAR)}\n${getStepSymbol(this.state)}  ${opts.message}${pageIndicator(
        this.cursor,
        this.filteredOptions.length,
        layout.pageItems,
      )}\n`;

      const filterLine = renderFilterLine(this.userInputWithCursor);

      if (this.state === 'submit' || this.state === 'cancel') {
        const focused = this.focusedValue;
        const selected = this.filteredOptions.find((o) => o.value === focused);
        const styled = selected
          ? radioOpt(selected, this.state === 'submit' ? 'submitted' : 'cancelled')
          : '';
        return `${titleLine}${pc.gray(S_BAR)}  ${styled}`;
      }

      const styled = (option: PickerOption<Value>, active: boolean): string =>
        radioOpt(option, active ? 'active' : 'inactive');

      const body =
        this.filteredOptions.length === 0
          ? `${pc.gray(S_BAR)}  ${pc.dim('No matches.')}`
          : renderColumnGrid(this.filteredOptions, this.cursor, layout, styled)
              .map((line) => `${pc.gray(S_BAR)}  ${line}`)
              .join('\n');

      return `${titleLine}${filterLine}\n${body}\n${renderHelpFooter(layout.maxRowWidth)}`;
    },
  });

  const resolved = await prompt.prompt();
  if (clackIsCancel(resolved)) return resolved;
  // `multiple: false` resolves to a single VALUE (clack normalises
  // `selectedValues[0]`), not an option object.
  return resolved as Value;
}

function getStepSymbol(state: string): string {
  switch (state) {
    case 'submit':
      return pc.green(S_STEP_SUBMIT);
    case 'cancel':
      return pc.red(S_STEP_CANCEL);
    case 'error':
      return pc.yellow(S_STEP_ERROR);
    default:
      return pc.cyan(S_BAR_START);
  }
}

function renderFilterLine(userInputWithCursor: string): string {
  return `${pc.gray(S_BAR)}  ${pc.dim('filter:')} ${userInputWithCursor}`;
}

function pageIndicator(cursor: number, total: number, maxItems: number | undefined): string {
  // No paging needed → no indicator. The total count already lives in
  // the title's summary fragment.
  if (!maxItems || maxItems <= 0 || total <= maxItems) return '';
  const page = Math.floor(cursor / maxItems) + 1;
  const pages = Math.max(1, Math.ceil(total / maxItems));
  return `  ${pc.dim(`(page ${page}/${pages})`)}`;
}

function renderHelpFooter(maxCells: number): string {
  // Clipped like the option rows: on a narrow terminal the full hint list
  // would wrap and throw off clack's line accounting on redraw.
  const hints = pc.dim(
    '↑/↓ next · PgUp/PgDn page · Home/End jump · space toggle · enter submit · type to filter',
  );
  return `${pc.gray(S_BAR_END)}  ${clipAnsiToWidth(hints, maxCells)}`;
}
