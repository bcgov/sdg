import { Button } from '@repo/design-system/components/button';
import { useCallback, useId, useState, type JSX, type ReactNode } from 'react';

import { CodeBlock } from '../code-block';

import styles from './example-preview.module.css';

export interface ExamplePreviewProps {
  /** The example's source, usually from `extractExample` so it matches what renders. */
  code: string;
  /** Names the example for the code toggle and copy buttons, e.g. "Primary sizes". */
  label: string;
  children: ReactNode;
}

/** A live example in a bordered frame, with a button that shows or hides its code. */
export function ExamplePreview({ code, label, children }: Readonly<ExamplePreviewProps>): JSX.Element {
  const [showCode, setShowCode] = useState(false);
  const toggleCode = useCallback(() => setShowCode((shown) => !shown), []);
  const codeId = useId();

  return (
    <div className={styles['example']}>
      <div className={styles['preview']}>{children}</div>
      <div className={styles['toolbar']}>
        <Button variant="tertiary" size="small" aria-expanded={showCode} aria-controls={codeId} onPress={toggleCode}>
          {showCode ? 'Hide code' : 'Show code'}
        </Button>
      </div>
      <div id={codeId} hidden={!showCode}>
        {showCode && <CodeBlock code={code} label={label} className={styles['code']} />}
      </div>
    </div>
  );
}
