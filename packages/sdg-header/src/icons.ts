import { faBars, faRightFromBracket, faXmark, type IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { html, svg, type TemplateResult } from 'lit';

/**
 * A decorative Font Awesome icon as inline SVG, sized to the surrounding text like `<FontAwesomeIcon>`. The paths use
 * Lit's `svg` tag: a nested `html` template would create them as HTML elements, which draw nothing.
 */
function icon({ iconName, icon: [width, height, , , path] }: IconDefinition): TemplateResult {
  const paths = Array.isArray(path) ? path : [path];
  return html`<svg
    class="icon"
    data-icon=${iconName}
    viewBox="0 0 ${width} ${height}"
    aria-hidden="true"
    focusable="false"
  >
    ${paths.map((d) => svg`<path fill="currentColor" d=${d}></path>`)}
  </svg>`;
}

export const barsIcon: TemplateResult = icon(faBars);
export const xmarkIcon: TemplateResult = icon(faXmark);
export const signOutIcon: TemplateResult = icon(faRightFromBracket);
