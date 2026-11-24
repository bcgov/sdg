import type { Cookie } from 'k6/browser';
import http from 'k6/http';

interface CookieOptions {
  domain?: string;
  path?: string;
  secure?: boolean;
  expires?: string;
  http_only?: boolean;
}

interface JarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiry?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

// Type guard for clientCookieData
const isCookieData = (value: unknown): value is { cookies: Cookie[] } => {
  return typeof value === 'object' && value !== null && 'cookies' in value && Array.isArray(value.cookies);
};

// Load client cookies from JSON file (absent during `k6 inspect` without prior setup)
const loadClientCookies = (): { cookies: Cookie[] } => {
  try {
    const parsed: unknown = JSON.parse(open('./client-auth.json'));
    return isCookieData(parsed) ? parsed : { cookies: [] };
  } catch {
    return { cookies: [] };
  }
};

// Load client cookies from JSON file (absent during `k6 inspect` without prior setup)
export const clientCookieData: { cookies: Cookie[] } = loadClientCookies();

/**
 * Formats a timestamp into a cookie expiry string.
 * @param {number} timestamp - The expiry time as a UNIX timestamp.
 * @returns The formatted expiry string.
 */
const formattedExpiry = (timestamp: number) => {
  const date = new Date(timestamp * 1000);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const weekday = weekdays[date.getUTCDay()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');

  return `${weekday}, ${day} ${month} ${year} ${hour}:${minute}:${second} MST`;
};

/**
 * Utility function to set cookies from a JSON file into the k6 Cookie Jar.
 * @param {JarCookie[]} cookieData - An array of cookie objects loaded from the JSON file.
 */
export const setCookies = (cookieData: { cookies: JarCookie[] }) => {
  const jar = http.cookieJar();
  cookieData.cookies.forEach((cookie) => {
    let expiresOption: CookieOptions = {
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
    };
    if (cookie.expiry) {
      expiresOption = {
        ...expiresOption,
        expires: formattedExpiry(cookie.expiry),
      };
    } else if (cookie.httpOnly) {
      expiresOption = {
        ...expiresOption,
        http_only: cookie.httpOnly,
      };
    }
    const webUrl = __ENV['BASE_URL']!;
    jar.set(webUrl, cookie.name, cookie.value, expiresOption);
  });
};
