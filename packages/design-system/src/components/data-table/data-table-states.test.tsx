import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTable, dataTableColumnHelper } from './index';
import type { TableConfig } from './index';

afterEach(cleanup);

interface Flag {
  key: string;
}

const helper = dataTableColumnHelper<Flag>();
const columns = [helper.accessor('key', { header: 'Key' })];

const config: TableConfig = {
  mode: 'numbered',
  search: true,
  filters: [{ key: 'enabled', label: 'Switch', options: [{ value: 'true', label: 'On' }] }],
};

const flags = (count: number, from = 1): Flag[] =>
  Array.from({ length: count }, (_, index) => ({ key: `flag-${from + index}` }));

const messages = {
  empty: 'There are no flags yet.',
  noMatches: 'No flags match.',
  error: "The flags couldn't be loaded.",
};

type Props = ComponentProps<typeof DataTable<Flag>>;

function renderTable(overrides: Partial<Props> = {}) {
  const onSearchChange = vi.fn<Props['onSearchChange']>();
  const onRetry = vi.fn<() => void>();
  const props: Props = {
    caption: 'Feature flags',
    columns,
    rows: flags(20),
    getRowId: (flag) => flag.key,
    config,
    paging: { mode: 'numbered', total: 134 },
    search: {},
    onSearchChange,
    onRetry,
    messages,
    status: 'ready',
    ...overrides,
  };
  const result = render(<DataTable {...props} />);
  const rerender = (next: Partial<Props>) => result.rerender(<DataTable {...props} {...next} />);
  return { onSearchChange, onRetry, rerender };
}

const grid = () => screen.getByRole('grid');
const bodyRows = () => within(grid()).getAllByRole('row').slice(1);
const pager = () => screen.queryByRole('navigation', { name: 'Pagination' });
const status = () => screen.getByRole('status');

describe('DataTable states (R11)', () => {
  it('Should show skeleton rows while loading, with the toolbar and no pager', () => {
    renderTable({ status: 'loading', rows: [] });
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(grid().closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDefined();
    expect(pager()).toBeNull();
  });

  it('Should show the empty message and hide the toolbar and pager when nothing is set', () => {
    renderTable({ rows: [], paging: { mode: 'numbered', total: 0 } });
    expect(within(grid()).getByText(messages.empty)).toBeDefined();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(pager()).toBeNull();
  });

  it('Should show the no-matches message with the search and filters to undo it (AE4)', async () => {
    const { onSearchChange } = renderTable({
      rows: [],
      paging: { mode: 'numbered', total: 0 },
      search: { q: 'zz', enabled: 'true' },
    });
    expect(within(grid()).getByText(messages.noMatches)).toBeDefined();
    expect(pager()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'zz' }, { replace: false });
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ enabled: 'true' }, { replace: false });
  });

  it('Should replace the rows with the error message and a retry', async () => {
    const { onRetry } = renderTable({ status: 'error' });
    expect(bodyRows()).toHaveLength(1);
    expect(within(grid()).getByText(messages.error)).toBeDefined();
    expect(pager()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Should show the blocked wording with the search clear button and no retry (KTD12)', () => {
    renderTable({ status: 'blocked', search: { q: "o'brien" } });
    expect(within(grid()).getByText(/The search was blocked/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(pager()).toBeNull();
  });

  it('Should keep the previous rows while refreshing, busy and with the pager disabled (KTD11)', () => {
    renderTable({ status: 'refreshing' });
    expect(bodyRows()).toHaveLength(20);
    expect(grid().closest('[aria-busy="true"]')).not.toBeNull();
    expect(within(pager()!).getByText('Showing 1–20 of 134')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('Should not be busy once ready', () => {
    renderTable();
    expect(grid().closest('[aria-busy="true"]')).toBeNull();
  });
});

describe('DataTable focus and announcements (R10, KTD11)', () => {
  it('Should move focus to the first row when Next runs out of pages, and announce the count', async () => {
    const { onSearchChange, rerender } = renderTable({ search: { page: '6' }, rows: flags(20, 101) });
    expect(status().textContent).toBe('Showing 101–120 of 134');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: '7' }, { replace: false });
    rerender({ search: { page: '7' }, rows: flags(20, 101), status: 'refreshing' });
    expect(status().textContent).toBe('');

    rerender({ search: { page: '7' }, rows: flags(14, 121), status: 'ready' });
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(bodyRows()[0]);
    expect(status().textContent).toBe('Showing 121–134 of 134');
  });

  it('Should hide the count, rows per page and pager when every row fits on a default page, still announcing the count', () => {
    renderTable({ rows: flags(15), paging: { mode: 'numbered', total: 15 } });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(status().textContent).toBe('Showing 1–15 of 15');
  });

  it('Should keep the footer when a smaller page size splits the rows over pages', () => {
    renderTable({ search: { pageSize: '10' }, rows: flags(10), paging: { mode: 'numbered', total: 15 } });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeNull();
  });

  it('Should move focus to the first row when a larger page size fits every row and the footer goes', async () => {
    const { rerender } = renderTable({
      search: { pageSize: '10' },
      rows: flags(10),
      paging: { mode: 'numbered', total: 15 },
    });
    screen.getByRole('button', { name: 'Next' }).focus();
    rerender({ search: {}, rows: flags(15), paging: { mode: 'numbered', total: 15 } });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(document.activeElement).toBe(bodyRows()[0]);
  });

  it('Should keep focus on Next while pages remain', async () => {
    const { rerender } = renderTable({ search: { page: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    rerender({ search: { page: '3' }, status: 'refreshing' });
    rerender({ search: { page: '3' }, status: 'ready' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
  });
});

describe('DataTable URL corrections (R14, KTD8)', () => {
  it('Should replace an invalid URL value with the corrected state once', () => {
    const { onSearchChange, rerender } = renderTable({ search: { pageSize: '7', q: 'check', other: 'kept' } });
    rerender({ status: 'refreshing', search: { pageSize: '7', q: 'check', other: 'kept' } });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'check', other: 'kept' }, { replace: true });
  });

  it('Should replace the page with the one the server clamped to', () => {
    const { onSearchChange } = renderTable({
      search: { page: '7' },
      rows: flags(14, 101),
      paging: { mode: 'numbered', total: 114, offset: 100 },
    });
    expect(onSearchChange).toHaveBeenCalledWith({ page: '6' }, { replace: true });
    expect(within(pager()!).getByText('Showing 101–114 of 114')).toBeDefined();
  });

  it('Should drop a newer-than cursor that reached the newest events (KTD3)', () => {
    const { onSearchChange } = renderTable({
      config: { mode: 'cursor' },
      search: { after: 'e5' },
      paging: { mode: 'cursor', older: 'e20', newer: null },
    });
    expect(onSearchChange).toHaveBeenCalledWith({}, { replace: true });
  });

  it('Should leave a valid URL alone', () => {
    const { onSearchChange } = renderTable({
      search: { page: '2' },
      paging: { mode: 'numbered', total: 134, offset: 20 },
    });
    expect(onSearchChange).not.toHaveBeenCalled();
  });
});
