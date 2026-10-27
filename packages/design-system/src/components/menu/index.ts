import type { Menu, MenuItem } from '@bcgov/design-system-react-components';
import type { ComponentProps } from 'react';

export {
  Menu,
  MenuItem,
  MenuSection,
  MenuSectionHeader,
  MenuTrigger,
  SubmenuTrigger,
} from '@bcgov/design-system-react-components';

export type MenuProps = ComponentProps<typeof Menu>;
export type MenuItemProps = ComponentProps<typeof MenuItem>;
