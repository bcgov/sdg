import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { RouterProvider } from 'react-aria-components';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTable, dataTableColumnHelper } from './index';
import type { TableConfig } from './index';

afterEach(cleanup);

interface Flag {
  key: string;
  overridesOn: number;
}

const helper = dataTableColumnHelper<Flag>();
const columns = [
  helper.accessor('key', { header: 'Key' }),
  helper.accessor('overridesOn', { header: 'Overrides', cell: (info) => `${info.getValue()} on` }),
];

const config: TableConfig = {
  mode: 'numbered',
  search: true,
  sortable: { key: 'asc', overridesOn: 'desc' },
  defaultSort: { column: 'key', direction: 'asc' },
};

const flags = (count: number, from = 1): Flag[] =>
  Array.from({ length: count }, (_, index) => ({ key: `flag-${from + index}`, overridesOn: index }));

type Props = ComponentProps<typeof DataTable<Flag>>;

function renderTable(overrides: Partial<Props> = {}) {
  const onSearchChange = vi.fn<Props['onSearchChange']>();
  const navigate = vi.fn<(path: string) => void>();
  const props: Props = {
    caption: 'Feature flags',
    columns,
    rows: flags(20),
    getRowId: (flag) => flag.key,
    getRowHref: (flag) => `/feature-flags/${flag.key}`,
    config,
    paging: { mode: 'numbered', total: 134 },
    search: {},
    onSearchChange,
    status: 'ready',
    ...overrides,
  };
  const view = (next: Props) => (
    <RouterProvider navigate={navigate}>
      <DataTable {...next} />
    </RouterProvider>
  );
  const result = render(view(props));
  const rerender = (next: Partial<Props>) => result.rerender(view({ ...props, ...next }));
  return { onSearchChange, navigate, rerender };
}

const overrides = () => screen.getByRole('columnheader', { name: /Overrides/ });
const button = (name: string) => screen.getByRole('button', { name });
const disabled = (name: string) => button(name).hasAttribute('disabled');

describe('DataTable numbered mode', () => {
  it('Should show the range, the page count and disable First and Previous on page 1 (R5)', () => {
    renderTable();
    const pager = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pager).getByText('Showing 1–20 of 134')).toBeDefined();
    expect(within(pager).getByText('Page 1 of 7')).toBeDefined();
    expect(disabled('First')).toBe(true);
    expect(disabled('Previous')).toBe(true);
    expect(disabled('Next')).toBe(false);
    expect(disabled('Last')).toBe(false);
  });

  it('Should push the next page and keep the other params on Next (R7)', async () => {
    const { onSearchChange } = renderTable({ search: { q: 'check', other: 'kept' } });
    await userEvent.click(button('Next'));
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'check', other: 'kept', page: '2' }, { replace: false });
  });

  it('Should cycle the Overrides sort: descending, ascending, then the default, each from page 1 (R4, AE3)', async () => {
    const { onSearchChange, rerender } = renderTable({ search: { page: '3' } });
    await userEvent.click(overrides());
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: 'overridesOn', order: 'desc' }, { replace: false });

    rerender({ search: { sort: 'overridesOn', order: 'desc' } });
    expect(overrides().getAttribute('aria-sort')).toBe('descending');
    await userEvent.click(overrides());
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: 'overridesOn', order: 'asc' }, { replace: false });

    rerender({ search: { sort: 'overridesOn', order: 'asc' } });
    expect(overrides().getAttribute('aria-sort')).toBe('ascending');
    await userEvent.click(overrides());
    expect(onSearchChange).toHaveBeenLastCalledWith({}, { replace: false });
  });

  it('Should make each row a link that Enter follows through the RouterProvider (R10, AE6)', async () => {
    const { navigate } = renderTable();
    const rows = screen.getAllByRole('row');
    const first = rows[1]!;
    expect(within(first).getByRole('rowheader').textContent).toBe('flag-1');
    expect(first.getAttribute('data-href')).toBe('/feature-flags/flag-1');

    await userEvent.click(rows[2]!);
    expect(navigate).toHaveBeenLastCalledWith('/feature-flags/flag-2', undefined);

    first.focus();
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenLastCalledWith('/feature-flags/flag-1', undefined);
  });

  it('Should add no <style> elements to the document', () => {
    const before = document.querySelectorAll('style').length;
    renderTable();
    expect(document.querySelectorAll('style')).toHaveLength(before);
  });
});

describe('DataTable cursor mode', () => {
  const cursorConfig: TableConfig = { mode: 'cursor' };

  it('Should show Newest, Newer and Older with no total, disabling Newer and Newest on the newest page (R6, AE5)', async () => {
    const { onSearchChange } = renderTable({
      config: cursorConfig,
      paging: { mode: 'cursor', older: 'e20', newer: null },
    });
    expect(disabled('Newest')).toBe(true);
    expect(disabled('Newer')).toBe(true);
    expect(disabled('Older')).toBe(false);
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(screen.queryByText(/Page \d/)).toBeNull();

    await userEvent.click(button('Older'));
    expect(onSearchChange).toHaveBeenCalledWith({ before: 'e20' }, { replace: false });
  });

  it('Should move to newer events and to the newest with the prefix (R7, R20)', async () => {
    const { onSearchChange } = renderTable({
      config: cursorConfig,
      prefix: 'h',
      search: { 'h.before': 'e40', q: 'list' },
      paging: { mode: 'cursor', older: 'e60', newer: 'e41' },
    });
    await userEvent.click(button('Newer'));
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: 'list', 'h.after': 'e41' }, { replace: false });
    await userEvent.click(button('Newest'));
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: 'list' }, { replace: false });
  });

  it('Should replace an older-than cursor with the newest page when nothing is newer, e.g. past the oldest event (R20)', () => {
    const { onSearchChange } = renderTable({
      config: cursorConfig,
      prefix: 'h',
      search: { 'h.before': 'e5', q: 'list' },
      rows: [],
      paging: { mode: 'cursor', older: null, newer: null },
    });
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'list' }, { replace: true });
  });
});
