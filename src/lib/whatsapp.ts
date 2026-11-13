/** WhatsApp links (wa.me): no account or bot needed, one tap opens the chat with the text ready. */

/** A Swiss or international number as digits with country code, or null if it does not look like one. */
export function whatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `41${d.slice(1)}`;
  return /^\d{9,15}$/.test(d) ? d : null;
}

/** Opens WhatsApp with the text; with a number it goes to that person, without it you pick a chat or group. */
export function whatsappLink(text: string, number?: string | null): string {
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}
