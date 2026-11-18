import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import type { JSX } from 'preact';

/**
 * A Font Awesome icon as inline SVG from its definition's path data, with none of fontawesome-svg-core's runtime or
 * injected CSS (the header ships no `<style>`). Decorative: the control's text names it.
 */
export function Icon({ icon, class: extra }: { icon: IconDefinition; class?: string }): JSX.Element {
  const [width, height, , , path] = icon.icon;
  return (
    <svg
      class={extra ? `icon ${extra}` : 'icon'}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {(Array.isArray(path) ? path : [path]).map((d) => (
        <path key={d} fill="currentColor" d={d} />
      ))}
    </svg>
  );
}
