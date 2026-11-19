import type { DetailedHTMLProps, HTMLAttributes } from 'react';

import type { SdgHeaderAttributes } from '../types.js';

/** JSX props for `<sdg-header>` used directly in React (prefer the `SdgHeader` wrapper, which also loads the script). */
export type SdgHeaderIntrinsicProps = DetailedHTMLProps<HTMLAttributes<HTMLElement> & SdgHeaderAttributes, HTMLElement>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'sdg-header': SdgHeaderIntrinsicProps;
    }
  }
}
