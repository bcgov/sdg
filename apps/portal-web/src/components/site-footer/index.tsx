import { Footer, FooterLinks } from '@repo/design-system/components/footer';

interface FooterLink {
  label: string;
  href: string;
}

/** gov.bc.ca's policy pages, in place of BCDS's default "More Info" list; each opens in a new tab. */
const LINKS: readonly FooterLink[] = [
  { label: 'Disclaimer', href: 'https://www2.gov.bc.ca/gov/content/home/disclaimer' },
  { label: 'Privacy', href: 'https://www2.gov.bc.ca/gov/content/home/privacy' },
  { label: 'Accessibility', href: 'https://www2.gov.bc.ca/gov/content/home/accessible-government' },
  { label: 'Copyright', href: 'https://www2.gov.bc.ca/gov/content/home/copyright' },
];

const FOOTER_LINKS = (
  <FooterLinks
    title="More Info"
    links={LINKS.map(({ label, href }) => (
      <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>
        {label}
      </a>
    ))}
  />
);

/** The BCDS footer with the portal's own link list; the acknowledgement, logo, contact and copyright stay BCDS's. */
export function SiteFooter() {
  return <Footer links={FOOTER_LINKS} />;
}
