import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { createLink } from '@tanstack/react-router';

/** Design-system link with TanStack Router navigation, type-safe `to`, and preloading. */
export const Link = createLink(DesignSystemLink);
