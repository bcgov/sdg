import { Text } from '@repo/design-system/components/text';

import { Link } from '../link';

/** The body of the "Page not found" page; the app shell shows its title as the `h1`. */
export function NotFound() {
  return (
    <>
      <Text elementType="p">The page you are looking for does not exist or has moved.</Text>
      <Link to="/">Go to the Dashboard</Link>
    </>
  );
}
