import { Button } from '@repo/design-system/components/button';
import { FontAwesomeIcon, faCheck, faCopy } from '@repo/design-system/icons';
import { useCallback, useEffect, useState, type JSX } from 'react';

import styles from './code-block.module.css';

export interface CodeBlockProps {
  code: string;
  /** Names the snippet for the copy button, e.g. "Usage". Without it there's no copy button. */
  label?: string;
  className?: string;
}

const copiedFor = 2000;

/** A preformatted code sample, with a button that copies it when the snippet has a label. */
export function CodeBlock({ code, label, className }: Readonly<CodeBlockProps>): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), copiedFor);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback((): void => {
    void navigator.clipboard.writeText(code).then(() => setCopied(true));
  }, [code]);

  return (
    <div className={[styles['codeBlock'], className].filter(Boolean).join(' ')}>
      {/* Positioned by a wrapper: a className on the BCDS button would replace its own classes. */}
      {label && (
        <div className={styles['copy']}>
          <Button
            variant="tertiary"
            size="small"
            isIconButton
            aria-label={copied ? `${label} code copied` : `Copy ${label} code`}
            onPress={copy}
          >
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
          </Button>
        </div>
      )}
      <pre className={styles['pre']}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
