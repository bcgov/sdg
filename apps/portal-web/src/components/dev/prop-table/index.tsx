import type { JSX } from 'react';

import styles from './prop-table.module.css';

/** Prop, type, default and notes. Use `—` for no default. */
export type PropRow = readonly [prop: string, type: string, defaultValue: string, notes: string];

export interface PropTableProps {
  /** Names the table, e.g. "Button props". */
  caption: string;
  rows: readonly PropRow[];
}

/** A component's props as a table: one row per prop. */
export function PropTable({ caption, rows }: Readonly<PropTableProps>): JSX.Element {
  return (
    <div className={styles['scroller']}>
      <table className={styles['table']}>
        <caption className={styles['caption']}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Prop</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, defaultValue, notes]) => (
            <tr key={prop}>
              <th scope="row">
                <code>{prop}</code>
              </th>
              <td>
                <code>{type}</code>
              </td>
              <td>
                <code>{defaultValue}</code>
              </td>
              <td>{notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
