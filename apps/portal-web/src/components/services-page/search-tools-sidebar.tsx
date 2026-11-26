import { Button } from '@repo/design-system/components/button';
import { Tooltip, TooltipTrigger } from '@repo/design-system/components/tooltip';
import { FontAwesomeIcon, regular } from '@repo/design-system/icons';
import { useCallback, useId, type ReactElement } from 'react';

import { TypeFilter, type ServiceType } from './type-filter';

import styles from './search-tools.module.css';

const CLOSE_ICON = <FontAwesomeIcon icon={regular.faSquareCaretLeft} aria-hidden="true" />;
const OPEN_ICON = <FontAwesomeIcon icon={regular.faSquareCaretRight} aria-hidden="true" />;

interface SearchToolsSidebarProps {
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  type: ServiceType;
  onTypeChange: (type: ServiceType) => void;
}

/** A labelled icon button with a matching tooltip (e.g. "Show sidebar"). */
function SidebarToggle({ label, icon, onPress }: Readonly<{ label: string; icon: ReactElement; onPress: () => void }>) {
  return (
    <TooltipTrigger delay={300}>
      <Button variant="tertiary" isIconButton aria-label={label} onPress={onPress}>
        {icon}
      </Button>
      <Tooltip placement="top">{label}</Tooltip>
    </TooltipTrigger>
  );
}

/**
 * Search tools beside the results on wide screens (Figma: Developer Handoff 83:105568): the panel, or collapsed to a
 * rail with the button that opens it. Medium and small screens hide it and use the sheet instead.
 */
export function SearchToolsSidebar({
  isExpanded,
  onExpandedChange,
  type,
  onTypeChange,
}: Readonly<SearchToolsSidebarProps>) {
  const headingId = useId();
  const open = useCallback(() => onExpandedChange(true), [onExpandedChange]);
  const close = useCallback(() => onExpandedChange(false), [onExpandedChange]);
  if (!isExpanded) {
    return (
      <aside className={`${styles['sidebar']} ${styles['rail']}`} aria-label="Search tools">
        <SidebarToggle label="Show sidebar" icon={OPEN_ICON} onPress={open} />
      </aside>
    );
  }
  return (
    <aside className={styles['sidebar']} aria-labelledby={headingId}>
      <div className={styles['sidebarHeader']}>
        <h2 id={headingId} className={styles['title']}>
          Search tools
        </h2>
        <SidebarToggle label="Hide sidebar" icon={CLOSE_ICON} onPress={close} />
      </div>
      <div className={styles['sidebarBody']}>
        <TypeFilter value={type} onChange={onTypeChange} />
      </div>
    </aside>
  );
}
