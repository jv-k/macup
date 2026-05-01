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
  limitOptions,
} from '@clack/prompts';
import pc from 'picocolors';
import { PageableAutocompletePrompt } from './pageable-prompt';

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

/**
 * Pageable multi-select prompt.
 *
 * Same API and rendering vocabulary as clack's stock
 * `autocompleteMultiselect`, plus:
 *   - PgUp / PgDn step the cursor by one visible window's worth.
 *   - Home / End jump to the top / bottom.
 *   - A right-aligned `N/M` page indicator on the message line, computed
 *     from the focused row and `maxItems`.
 *
 * Typing-to-filter still works via the underlying AutocompletePrompt's
 * `userInput` plumbing, just like clack's stock prompt.
 */
export async function pageableAutocompleteMultiselect<Value>(
  opts: PickerOptions<Value>,
): Promise<readonly Value[] | symbol> {
  const required = opts.required ?? true;
  const maxItems = opts.maxItems;

  const prompt: PageableAutocompletePrompt<PickerOption<Value>> = new PageableAutocompletePrompt<
    PickerOption<Value>
  >({
    options: opts.options,
    multiple: true,
    initialValue: opts.initialValues ? [...opts.initialValues] : undefined,
    pageSize: maxItems ?? 10,
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
      const titleLine = `${pc.gray(S_BAR)}\n${getStepSymbol(this.state)}  ${opts.message}${pageIndicator(
        this.cursor,
        this.filteredOptions.length,
        maxItems,
      )}\n`;

      const filterLine = renderFilterLine(this.userInputWithCursor);

      // Cancellation / submission render: collapse to the picked rows
      // (or strikethrough on cancel), matching clack's stock behavior.
      if (this.state === 'submit') {
        const selected = (this.value as PickerOption<Value>[] | undefined) ?? [];
        return `${titleLine}${pc.gray(S_BAR)}  ${
          selected.length > 0
            ? selected.map((o) => opt(o, 'submitted')).join(pc.dim(', '))
            : pc.dim('(none)')
        }`;
      }
      if (this.state === 'cancel') {
        const selected = (this.value as PickerOption<Value>[] | undefined) ?? [];
        return `${titleLine}${pc.gray(S_BAR)}  ${
          selected.length > 0 ? selected.map((o) => opt(o, 'cancelled')).join(pc.dim(', ')) : ''
        }${selected.length > 0 ? `\n${pc.gray(S_BAR)}` : ''}`;
      }

      // Active render: filter input + visible window of options.
      const styled = (option: PickerOption<Value>, active: boolean): string => {
        const isSelected = (this.selectedValues as Value[]).includes(option.value as Value);
        if (active && isSelected) return opt(option, 'active-selected');
        if (active) return opt(option, 'active');
        if (isSelected) return opt(option, 'selected');
        return opt(option, 'inactive');
      };

      const visible = limitOptions({
        cursor: this.cursor,
        options: this.filteredOptions,
        maxItems,
        style: styled,
      });

      const empty =
        this.filteredOptions.length === 0
          ? `${pc.gray(S_BAR)}  ${pc.dim('No matches.')}`
          : visible.map((line) => `${pc.gray(S_BAR)}  ${line}`).join('\n');

      const footer = renderHelpFooter();

      const errorLine = this.error ? `\n${pc.yellow(S_BAR_END)}  ${pc.yellow(this.error)}` : '';

      return `${titleLine}${filterLine}\n${empty}\n${footer}${errorLine}`;
    },
  });

  // Coerce the resolved value into the array of plain Values the caller expects.
  const resolved = await prompt.prompt();
  if (clackIsCancel(resolved)) return resolved;
  const arr = (resolved as PickerOption<Value>[] | undefined) ?? [];
  return arr.map((o) => o.value);
}

/**
 * Single-pick variant for symmetry / future use. Not yet wired into the
 * CLI — the existing `select` from clack handles the target prompt fine.
 * Exported for potential use by a future "pick one outdated" flow.
 */
export async function pageableSelect<Value>(
  opts: Omit<PickerOptions<Value>, 'initialValues'> & { initialValue?: Value },
): Promise<Value | symbol> {
  const maxItems = opts.maxItems;

  const prompt: PageableAutocompletePrompt<PickerOption<Value>> = new PageableAutocompletePrompt<
    PickerOption<Value>
  >({
    options: opts.options,
    multiple: false,
    initialValue: opts.initialValue !== undefined ? [opts.initialValue] : undefined,
    pageSize: maxItems ?? 10,
    render(this: PageableAutocompletePrompt<PickerOption<Value>>) {
      const titleLine = `${pc.gray(S_BAR)}\n${getStepSymbol(this.state)}  ${opts.message}${pageIndicator(
        this.cursor,
        this.filteredOptions.length,
        maxItems,
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

      const visible = limitOptions({
        cursor: this.cursor,
        options: this.filteredOptions,
        maxItems,
        style: styled,
      });

      const body =
        this.filteredOptions.length === 0
          ? `${pc.gray(S_BAR)}  ${pc.dim('No matches.')}`
          : visible.map((line) => `${pc.gray(S_BAR)}  ${line}`).join('\n');

      return `${titleLine}${filterLine}\n${body}\n${renderHelpFooter()}`;
    },
  });

  const resolved = await prompt.prompt();
  if (clackIsCancel(resolved)) return resolved;
  const arr = resolved as PickerOption<Value>[] | undefined;
  return (arr?.[0]?.value ?? undefined) as Value;
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
  if (!maxItems || maxItems <= 0 || total <= maxItems) {
    return total > 0 ? `  ${pc.dim(`(${total})`)}` : '';
  }
  const page = Math.floor(cursor / maxItems) + 1;
  const pages = Math.max(1, Math.ceil(total / maxItems));
  return `  ${pc.dim(`(${total} · page ${page}/${pages})`)}`;
}

function renderHelpFooter(): string {
  const dim = pc.dim;
  return `${pc.gray(S_BAR_END)}  ${dim('↑/↓ navigate · PgUp/PgDn page · Home/End jump · space toggle · enter submit · type to filter')}`;
}
