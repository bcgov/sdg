// Entry of the self-contained CDN bundle (`vite build --mode cdn`), one classic script per major. It registers the
// element with an explicit call: a bare side-effect import would be dropped, since package.json marks src side-effect
// free.
import { defineSdgHeader } from './sdg-header-element.js';

defineSdgHeader();
