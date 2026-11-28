import { TagGroup, TagList, type TagProps } from '@repo/design-system/components/tag';

import logoSquareBc from './logo-square-bc.svg';
import logoSquareCa from './logo-square-ca.png';

import styles from './service-types.module.css';

interface ServiceType {
  id: string;
  /** One tag, in a list as TagList takes it. */
  tags: TagProps[];
  description: string;
}

const TAG_STYLE = { size: 'xsmall', tagStyle: 'rectangular' } as const;

const TYPES: readonly ServiceType[] = [
  {
    id: 'service',
    tags: [{ id: 'service', textValue: 'Service', color: 'yellow', ...TAG_STYLE }],
    description: 'An online form or application you complete, like Change your address.',
  },
  {
    id: 'bc-platform',
    tags: [
      {
        ...TAG_STYLE,
        id: 'bc-platform',
        textValue: 'Platform',
        color: 'blue',
        icon: <img className={styles['logo']} src={logoSquareBc} alt="" width={16} height={16} />,
      },
    ],
    description: 'A website or app where you can do several things, like Health Gateway. It opens in its own site.',
  },
  {
    id: 'canada-platform',
    tags: [
      {
        ...TAG_STYLE,
        id: 'canada-platform',
        textValue: 'Platform',
        color: 'red',
        icon: (
          // The flag is wider than the tag's 16px icon box, which shows its centre: the maple leaf.
          <span className={styles['flag']}>
            <img src={logoSquareCa} alt="" width={32} height={15} />
          </span>
        ),
      },
    ],
    description: 'A platform run by the Government of Canada, like Canada Revenue Agency - CRA Account.',
  },
];

/** Figma: Product Discussions, node 752:6037. What each kind of tag on a service means. */
export function ServiceTypes() {
  return (
    <table className={styles['table']}>
      <thead>
        <tr>
          <th scope="col" className={styles['tagColumn']}>
            <span>Tag</span>
          </th>
          <th scope="col">
            <span>Description</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {TYPES.map(({ id, tags, description }) => (
          <tr key={id}>
            <td>
              <TagGroup aria-label="Tag">
                <TagList items={tags} />
              </TagGroup>
            </td>
            <td>{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
