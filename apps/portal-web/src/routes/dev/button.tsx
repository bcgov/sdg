import { Button, type ButtonProps } from '@repo/design-system/components/button';
import { ButtonGroup } from '@repo/design-system/components/button-group';
import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

import styles from './dev.module.css';

export const Route = createFileRoute('/dev/button')({
  component: ButtonPage,
});

const variants: NonNullable<ButtonProps['variant']>[] = ['primary', 'secondary', 'tertiary', 'link', 'warning'];
const sizes: NonNullable<ButtonProps['size']>[] = ['xsmall', 'small', 'medium', 'large'];

const label = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function ButtonPage() {
  return (
    <>
      <Heading level={1}>Button</Heading>
      {variants.map((variant) => (
        <section key={variant} aria-labelledby={`button-${variant}-heading`}>
          <Heading level={2} id={`button-${variant}-heading`}>
            {label(variant)}
          </Heading>
          <div className={styles['rows']}>
            <ButtonGroup ariaLabel={`${label(variant)} sizes`}>
              {sizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {label(size)}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup ariaLabel={`${label(variant)} states`}>
              <Button variant={variant} danger>
                Danger
              </Button>
              <Button variant={variant} isDisabled>
                Disabled
              </Button>
            </ButtonGroup>
          </div>
        </section>
      ))}
    </>
  );
}
