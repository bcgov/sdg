import { Heading } from '@repo/design-system/components/heading';
import { Text } from '@repo/design-system/components/text';

import { Link } from '../link';

export function NotFound() {
  return (
    <>
      <Heading level={1}>Page not found</Heading>
      <Text elementType="p">The page you are looking for does not exist or has moved.</Text>
      <Link to="/">Go to the home page</Link>
    </>
  );
}
