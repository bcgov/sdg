import { faCircleQuestion, faGauge, faGear, faKey, type IconDefinition } from '@repo/design-system/icons';

/** A sidebar destination: one of the console's signed-in pages. */
export interface NavItem {
  readonly label: string;
  readonly to: '/' | '/service-clients' | '/settings' | '/help';
  readonly icon: IconDefinition;
}

/** The sidebar's Main navigation (R9). */
export const MAIN_NAV: readonly NavItem[] = [
  { label: 'Dashboard', to: '/', icon: faGauge },
  { label: 'Service Accounts', to: '/service-clients', icon: faKey },
];

/** The sidebar's Secondary navigation, at its bottom (R10). */
export const SECONDARY_NAV: readonly NavItem[] = [
  { label: 'Settings', to: '/settings', icon: faGear },
  { label: 'Get help', to: '/help', icon: faCircleQuestion },
];

/** Every destination, Main then Secondary: what the command palette searches (R14). */
export const ALL_NAV: readonly NavItem[] = [...MAIN_NAV, ...SECONDARY_NAV];
