import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '../../components/settings-page';

// The header's user menu links every site's Settings here (`SETTINGS_PATH` in @repo/shared-ui). Signed in only.
export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
});
