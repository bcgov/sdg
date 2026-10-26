export type { IconDefinition, IconProp } from '@fortawesome/fontawesome-svg-core';
export { FontAwesomeIcon, type FontAwesomeIconProps } from '@fortawesome/react-fontawesome';

// Solid is the default style; regular is namespaced because its names collide with solid (e.g. faUser).
export * from '@fortawesome/free-solid-svg-icons';
export * as regular from '@fortawesome/free-regular-svg-icons';
