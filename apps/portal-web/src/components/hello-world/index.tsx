import { Text } from '@repo/design-system/components/text';
import { useFlag } from '@repo/feature-flags';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchHelloWorld } from './api';

/**
 * The `hello_world` flag demo. Asks the endpoint only when the flag is on, once per page load, and renders nothing
 * while the flag or the message is pending, when the flag is off, or when the endpoint answers 404 or fails.
 */
export function HelloWorld() {
  const { isEnabled } = useFlag('hello_world');
  const { data, error } = useQuery({
    queryKey: ['hello-world'],
    queryFn: fetchHelloWorld,
    enabled: isEnabled,
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (error) console.warn('portal-web: hello-world unavailable', error);
  }, [error]);

  if (!isEnabled || typeof data !== 'string') return null;
  return <Text elementType="p">{data}</Text>;
}
