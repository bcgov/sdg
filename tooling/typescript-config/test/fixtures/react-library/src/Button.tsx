import type { JSX } from 'react';

export interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps): JSX.Element {
  return <button type="button">{label}</button>;
}
