import { TextField as UpstreamTextField } from '@bcgov/design-system-react-components';
import { useMemo, type ComponentProps, type JSX } from 'react';

import styles from './text-field.module.css';

type UpstreamTextFieldProps = ComponentProps<typeof UpstreamTextField>;
type OwnSize = 'xsmall' | 'large';

export type TextFieldProps = Omit<UpstreamTextFieldProps, 'size'> & {
  /** Upstream sizes plus `xsmall` (24px, label text) and `large` (48px). Defaults to `medium`. */
  size?: UpstreamTextFieldProps['size'] | OwnSize;
};

const isOwnSize = (size: TextFieldProps['size']): size is OwnSize => size === 'xsmall' || size === 'large';

function hasUpstreamSize(props: TextFieldProps): props is UpstreamTextFieldProps {
  return !isOwnSize(props.size);
}

// Upstream spreads props after its own className, so a passed className replaces its root class: restate it.
function sizedClassName(size: OwnSize, className: UpstreamTextFieldProps['className']) {
  const classes = (extra: string | undefined) =>
    ['bcds-react-aria-TextField', styles[size], extra].filter(Boolean).join(' ');
  if (typeof className !== 'function') return classes(className);
  return (values: Parameters<typeof className>[0]) => classes(className(values));
}

/**
 * The design-system `TextField` with extra `xsmall` and `large` sizes; `small` and `medium` render the upstream field
 * untouched.
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const { size, className } = props;
  const sized = useMemo(() => (isOwnSize(size) ? sizedClassName(size, className) : undefined), [size, className]);

  // Pass upstream sizes through as given: even `className={undefined}` would replace upstream's root class.
  if (hasUpstreamSize(props)) return <UpstreamTextField {...props} />;
  const { size: _size, className: _className, ...rest } = props;
  return <UpstreamTextField {...rest} className={sized} />;
}
