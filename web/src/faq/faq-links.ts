/**
 * Which URLs the "Ask anything" island turns into clickable links.
 *
 * The prompt carries text the site did not write — block numbers and address
 * strings come straight out of the city's published files — so a crafted value
 * could steer an answer toward an attacker's URL, and every later visitor
 * asking about that record would get it as a link. Only this site's own https
 * URLs become links; any other URL the model emits is still shown, as plain
 * text. (Same allowlist shape as hospital-ledger's src/faq/faq-links.ts.)
 */
export const FAQ_LINK_HOST = "sf-property-ledger.barkleesanders.workers.dev";

export function isSiteLink(href: string): boolean {
  let host: string;

  try {
    const url = new URL(href);

    if (url.protocol !== "https:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }

  return host === FAQ_LINK_HOST || host.endsWith(`.${FAQ_LINK_HOST}`);
}
