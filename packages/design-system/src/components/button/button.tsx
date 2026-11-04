import { Button as UpstreamButton } from '@bcgov/design-system-react-components';
import type { ComponentProps, JSX } from 'react';

import styles from './button.module.css';

type UpstreamButtonProps = ComponentProps<typeof UpstreamButton>;

export type ButtonProps = Omit<UpstreamButtonProps, 'variant'> & {
  /** Upstream variants plus `warning`: B.C. gold, for actions that need care but aren't destructive. Defaults to `primary`. */
  variant?: UpstreamButtonProps['variant'] | 'warning';
};

/**
 * The design-system `Button` with an extra `warning` variant; every other variant renders the upstream button untouched.
 * `danger` wins over `warning`, rendering the upstream primary danger button.
 */
export function Button({ variant, ...props }: ButtonProps): JSX.Element {
  if (variant !== 'warning') return <UpstreamButton {...props} variant={variant} />;
  if (props.danger) return <UpstreamButton {...props} variant="primary" />;

  // Upstream spreads props after its own className, so a passed className replaces its classes: restate them.
  const { size = 'medium', isIconButton = false, className, ...rest } = props;
  const classes = ['bcds-react-aria-Button', size, isIconButton && 'icon', styles['warning'], className]
    .filter(Boolean)
    .join(' ');
  return <UpstreamButton {...rest} className={classes} />;
}
