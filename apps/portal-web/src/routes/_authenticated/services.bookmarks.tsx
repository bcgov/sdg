import { createFileRoute } from '@tanstack/react-router';

import { ServicesPage } from '../../components/services-page';

// The Services page's Bookmarks tab. Bookmarks are the resident's own, so it is signed in only.
export const Route = createFileRoute('/_authenticated/services/bookmarks')({
  component: BookmarksRoute,
});

function BookmarksRoute() {
  return <ServicesPage tab="bookmarks" />;
}
