import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

import { Link } from '../../components/link';

// Local development helpers, not linked from the app: pages for checking design-system components. Start at /dev.
export const Route = createFileRoute('/dev/')({
  component: DevPage,
});

function DevPage() {
  return (
    <>
      <Heading level={1}>Dev helpers</Heading>
      <Heading level={2}>Components</Heading>
      <ul>
        <li>
          <Link to="/dev/button">Button</Link>
        </li>
        <li>
          <Link to="/dev/card">Card</Link>
        </li>
      </ul>
    </>
  );
}
