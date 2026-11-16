import { describe, expect, it } from 'vitest';

import {
  goToCursor,
  goToPage,
  readTableState,
  setFilter,
  setPageSize,
  setSearch,
  setSort,
  tableParamKeys,
  type TableConfig,
  type TableState,
  writeTableState,
} from './table-state';

const flags: TableConfig = {
  mode: 'numbered',
  search: true,
  filters: [
    {
      key: 'audience',
      label: 'Audience',
      options: [
        { value: 'portal', label: 'Portal' },
        { value: 'console', label: 'Console' },
      ],
    },
    {
      key: 'enabled',
      label: 'Switch',
      options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
      ],
    },
  ],
  sortable: { key: 'asc', audience: 'asc', enabled: 'asc', rolloutPct: 'desc', overridesOn: 'desc' },
  defaultSort: { column: 'key', direction: 'asc' },
};

const history: TableConfig = { mode: 'cursor' };

const flagDefaults: TableState = {
  search: '',
  filters: {},
  sort: { column: 'key', direction: 'asc' },
  pageSize: 20,
  page: 1,
  cursor: null,
};

const page3: TableState = {
  search: 'check',
  filters: { audience: 'portal' },
  sort: { column: 'rolloutPct', direction: 'asc' },
  pageSize: 50,
  page: 3,
  cursor: null,
};

describe('readTableState', () => {
  it('Should give the defaults for an empty URL (R7, R9)', () => {
    expect(readTableState({}, flags)).toEqual({ state: flagDefaults, corrected: false });
  });

  it('Should round-trip a page and a sort through the URL (R7)', () => {
    const params = { page: '3', sort: 'rolloutPct', order: 'asc' };
    const { state, corrected } = readTableState(params, flags);
    expect(corrected).toBe(false);
    expect(state).toEqual({ ...flagDefaults, page: 3, sort: { column: 'rolloutPct', direction: 'asc' } });
    expect(writeTableState(state, flags)).toEqual(params);
  });

  it('Should use the column first direction when the URL names a sort without an order (R4)', () => {
    expect(readTableState({ sort: 'overridesOn' }, flags).state.sort).toEqual({
      column: 'overridesOn',
      direction: 'desc',
    });
  });

  it('Should read a prefixed cursor and ignore unprefixed params (R7)', () => {
    const params = { 'h.before': '42', before: '7', page: '3', q: 'check' };
    expect(readTableState(params, history, 'h')).toEqual({
      state: { search: '', filters: {}, sort: undefined, pageSize: 20, page: 1, cursor: { before: '42' } },
      corrected: false,
    });
  });

  it('Should read an after cursor in cursor mode (R20)', () => {
    expect(readTableState({ after: '9' }, history).state.cursor).toEqual({ after: '9' });
  });

  it('Should fall back to the default sort for an unknown column and flag the correction', () => {
    const { state, corrected } = readTableState({ sort: 'bogus', page: '2' }, flags);
    expect(corrected).toBe(true);
    expect(state).toEqual({ ...flagDefaults, page: 2 });
  });

  it('Should fall back to 20 rows for a page size outside 10, 20, 50 and 100 (R9)', () => {
    for (const pageSize of ['7', '200', '20.5', 'abc', '']) {
      const { state, corrected } = readTableState({ pageSize }, flags);
      expect(corrected).toBe(true);
      expect(state.pageSize).toBe(20);
    }
    expect(readTableState({ pageSize: '100' }, flags)).toEqual({
      state: { ...flagDefaults, pageSize: 100 },
      corrected: false,
    });
  });

  it('Should fall back to page 1 for a malformed page number', () => {
    for (const page of ['0', '-1', '2.5', '1e3', 'x', '', '99999999999999999999']) {
      const { state, corrected } = readTableState({ page }, flags);
      expect(corrected).toBe(true);
      expect(state.page).toBe(1);
    }
  });

  it('Should drop an unknown filter value or order and flag the correction', () => {
    expect(readTableState({ audience: 'both' }, flags)).toEqual({ state: flagDefaults, corrected: true });
    expect(readTableState({ sort: 'rolloutPct', order: 'up' }, flags)).toEqual({
      state: { ...flagDefaults, sort: { column: 'rolloutPct', direction: 'desc' } },
      corrected: true,
    });
  });

  it('Should drop a malformed cursor and flag the correction (R20)', () => {
    expect(readTableState({ before: '42', after: '43' }, history).state.cursor).toBeNull();
    expect(readTableState({ before: '42', after: '43' }, history).corrected).toBe(true);
    expect(readTableState({ before: '' }, history)).toMatchObject({ state: { cursor: null }, corrected: true });
  });

  it('Should read only string values', () => {
    const { state, corrected } = readTableState({ page: 3, q: ['a', 'b'], enabled: false }, flags);
    expect(state).toEqual(flagDefaults);
    expect(corrected).toBe(true);
  });

  it('Should keep q=123, q=true and enabled=false as strings and write them back unquoted (KTD8)', () => {
    for (const q of ['123', 'true']) {
      const { state } = readTableState({ q, enabled: 'false' }, flags);
      expect(state.search).toBe(q);
      expect(state.filters).toEqual({ enabled: 'false' });
      expect(writeTableState(state, flags)).toEqual({ q, enabled: 'false' });
    }
  });
});

describe('writeTableState', () => {
  it('Should give a clean URL for the default view (R7)', () => {
    expect(writeTableState(flagDefaults, flags)).toEqual({});
    expect(writeTableState(flagDefaults, history, 'h')).toEqual({});
  });

  it('Should write only non-default values, prefixed when the table has a prefix (R7)', () => {
    expect(writeTableState(page3, flags, 'f')).toEqual({
      'f.q': 'check',
      'f.audience': 'portal',
      'f.sort': 'rolloutPct',
      'f.order': 'asc',
      'f.pageSize': '50',
      'f.page': '3',
    });
  });

  it('Should write the cursor and not the page in cursor mode (R20)', () => {
    const state: TableState = { ...flagDefaults, sort: undefined, page: 4, cursor: { after: '9' } };
    expect(writeTableState(state, history, 'h')).toEqual({ 'h.after': '9' });
  });
});

describe('tableParamKeys', () => {
  it('Should name every URL key the table owns, so a caller can drop stale ones (R7)', () => {
    expect(tableParamKeys(flags).toSorted()).toEqual(
      ['q', 'audience', 'enabled', 'sort', 'order', 'pageSize', 'page'].toSorted(),
    );
    expect(tableParamKeys(history, 'h').toSorted()).toEqual(['h.after', 'h.before', 'h.pageSize']);
  });
});

describe('transitions', () => {
  it('Should start a number column descending, then ascending, then return to the default sort (R4, AE3)', () => {
    const first = setSort(page3, flags, 'overridesOn');
    expect(first.state.sort).toEqual({ column: 'overridesOn', direction: 'desc' });
    const second = setSort(first.state, flags, 'overridesOn');
    expect(second.state.sort).toEqual({ column: 'overridesOn', direction: 'asc' });
    const third = setSort(second.state, flags, 'overridesOn');
    expect(third.state.sort).toEqual({ column: 'key', direction: 'asc' });
  });

  it('Should toggle the direction on the default sort column (R4)', () => {
    const desc = setSort(flagDefaults, flags, 'key');
    expect(desc.state.sort).toEqual({ column: 'key', direction: 'desc' });
    expect(setSort(desc.state, flags, 'key').state.sort).toEqual({ column: 'key', direction: 'asc' });
  });

  it('Should reset to page 1 and push when the sort changes (R8)', () => {
    const { state, replace } = setSort(page3, flags, 'audience');
    expect(state).toEqual({ ...page3, sort: { column: 'audience', direction: 'asc' }, page: 1 });
    expect(replace).toBe(false);
  });

  it('Should reset to page 1 and push when the search changes (R8, AE1)', () => {
    const { state, replace } = setSearch(page3, 'flag');
    expect(state).toEqual({ ...page3, search: 'flag', page: 1 });
    expect(replace).toBe(false);
    expect(writeTableState(state, flags)).not.toHaveProperty('page');
  });

  it('Should reset to page 1 and push when a filter is set or cleared (R8)', () => {
    const set = setFilter(page3, 'enabled', 'true');
    expect(set).toEqual({
      state: { ...page3, filters: { audience: 'portal', enabled: 'true' }, page: 1 },
      replace: false,
    });
    const cleared = setFilter(page3, 'audience', undefined);
    expect(cleared).toEqual({ state: { ...page3, filters: {}, page: 1 }, replace: false });
  });

  it('Should reset to page 1 and push when the page size changes (R8, R9)', () => {
    expect(setPageSize(page3, 100)).toEqual({ state: { ...page3, pageSize: 100, page: 1 }, replace: false });
  });

  it('Should keep search, filters and sort and push when moving to another page (R7)', () => {
    expect(goToPage(page3, 4)).toEqual({ state: { ...page3, page: 4 }, replace: false });
  });

  it('Should return to the newest events when a cursor-mode change resets the position (R8)', () => {
    const older: TableState = { ...flagDefaults, sort: undefined, cursor: { before: '42' } };
    expect(setPageSize(older, 50).state.cursor).toBeNull();
    expect(setSearch(older, 'x').state.cursor).toBeNull();
  });

  it('Should move the cursor and push, keeping the page size (R20)', () => {
    const state: TableState = { ...flagDefaults, sort: undefined, pageSize: 50 };
    expect(goToCursor(state, { before: '42' })).toEqual({
      state: { ...state, cursor: { before: '42' } },
      replace: false,
    });
    expect(goToCursor({ ...state, cursor: { before: '42' } }, null).state.cursor).toBeNull();
  });
});
