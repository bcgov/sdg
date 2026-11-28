const HELP = 'https://id.gov.bc.ca/static/help';

/** BC Services Card help pages that more than one page links to. */
export const HELP_URLS = {
  setUpApp: `${HELP}/setup_app.html`,
  logInFromComputer: `${HELP}/login_fromcomputer.html`,
  getToken: 'https://id.gov.bc.ca/account/token-setup-instruction',
} as const;
