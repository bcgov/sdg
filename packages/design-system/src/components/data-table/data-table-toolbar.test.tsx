import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  filters: [
    {
      key: 'enabled',
      label: 'Switch',
      options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
      ],
    },
  ],
  sortable: { key: 'asc' },
  defaultSort: { column: 'key', direction: 'asc' },
};

type Props = ComponentProps<typeof DataTable<Flag>>;

function renderTable(overrides: Partial<Props> = {}) {
  const onSearchChange = vi.fn<Props['onSearchChange']>();
  const props: Props = {
    caption: 'Feature flags',
    columns,
    rows: [{ key: 'flag-1' }],
    getRowId: (flag) => flag.key,
    config,
    paging: { mode: 'numbered', total: 80 },
    search: {},
    onSearchChange,
    status: 'ready',
    ...overrides,
  };
  const result = render(<DataTable {...props} />);
  const rerender = (next: Partial<Props>) => result.rerender(<DataTable {...props} {...next} />);
  return { onSearchChange, rerender };
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search' });

describe('DataTable toolbar', () => {
  it('Should apply a search once typing pauses, from page 1, and push (R8, AE1)', async () => {
    const { onSearchChange } = renderTable({ search: { page: '3' } });
    await userEvent.type(searchBox(), 'check');
    expect(onSearchChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(1));
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'check' }, { replace: false });
  });

  it('Should replace the entry for a second edit while the field keeps focus (KTD8)', async () => {
    const { onSearchChange, rerender } = renderTable();
    await userEvent.type(searchBox(), 'che');
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(1));
    rerender({ search: { q: 'che' } });

    await userEvent.type(searchBox(), 'ck');
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(2));
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: 'check' }, { replace: true });
  });

  it('Should push the first edit after the field regains focus', async () => {
    const { onSearchChange } = renderTable({ search: { q: 'che' } });
    await userEvent.type(searchBox(), 'ck');
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(1));
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: 'check' }, { replace: false });
  });

  it('Should show the search from the URL and follow it when the URL changes (Back)', () => {
    const { rerender } = renderTable({ search: { q: 'check' } });
    expect(searchBox()).toHaveProperty('value', 'check');
    rerender({ search: {} });
    expect(searchBox()).toHaveProperty('value', '');
  });

  it('Should push a chosen filter from page 1 (R8)', async () => {
    const { onSearchChange } = renderTable({ search: { page: '2', q: 'check' } });
    await userEvent.click(screen.getByRole('button', { name: /Switch/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Off' }));
    expect(onSearchChange).toHaveBeenCalledWith({ q: 'check', enabled: 'false' }, { replace: false });
  });

  it('Should push Any as no filter', async () => {
    const { onSearchChange } = renderTable({ search: { enabled: 'true' } });
    await userEvent.click(screen.getByRole('button', { name: /Switch/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Any' }));
    expect(onSearchChange).toHaveBeenCalledWith({}, { replace: false });
  });

  it('Should offer Clear filters only when a filter is set, clearing the filters and keeping the search (R3)', async () => {
    const { onSearchChange, rerender } = renderTable({ search: { q: 'check' } });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    rerender({ search: { q: 'check', enabled: 'true', page: '2', sort: 'key', order: 'desc', other: 'kept' } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith(
      { q: 'check', sort: 'key', order: 'desc', other: 'kept' },
      { replace: false },
    );
    expect(searchBox()).toHaveProperty('value', 'check');
  });

  it('Should clear the search at once from its × button, keeping the filters, and show the × only with text', async () => {
    const { onSearchChange } = renderTable({ search: { q: 'check', enabled: 'true', page: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith({ enabled: 'true' }, { replace: false });
    expect(searchBox()).toHaveProperty('value', '');
    expect(searchBox().closest('[data-empty]')).not.toBeNull();
  });

  it('Should clear the search with Escape', async () => {
    const { onSearchChange } = renderTable({ search: { q: 'check' } });
    searchBox().focus();
    await userEvent.keyboard('{Escape}');
    expect(onSearchChange).toHaveBeenCalledWith({}, { replace: false });
  });

  it('Should push a new page size from page 1 (R9)', async () => {
    const { onSearchChange } = renderTable({ search: { page: '2' } });
    expect(screen.getByRole('button', { name: /Rows per page/ }).textContent).toContain('20');
    await userEvent.click(screen.getByRole('button', { name: /Rows per page/ }));
    await userEvent.click(screen.getByRole('option', { name: '50' }));
    expect(onSearchChange).toHaveBeenCalledWith({ pageSize: '50' }, { replace: false });
  });
});
