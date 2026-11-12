/**
 * EAN/GTIN helpers. Packaged goods carry EAN-13 (sometimes EAN-8 or UPC-A).
 * A camera can misread a code; the check digit catches nearly all misreads.
 */

/** The GS1 check digit for the given digits (without the check digit). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,… starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * Normalises a scanned value for lookup: trims whitespace, turns a 12-digit
 * UPC-A into its EAN-13 form. Non-numeric codes (Code128, QR labels) are
 * returned trimmed and otherwise untouched.
 */
export function normalizeCode(raw: string): string {
  const code = raw.trim().replace(/\s+/g, '');
  if (/^\d{12}$/.test(code)) return `0${code}`;
  return code;
}

/** Whether a scan should be accepted as a code: numeric codes need a valid check digit. */
export function isAcceptableScan(raw: string): boolean {
  const code = normalizeCode(raw);
  if (code.length === 0 || code.length > 64) return false;
  if (/^\d+$/.test(code)) return isValidGtin(code);
  return true;
}

/** Builds a valid EAN-13 from 12 body digits (used for sample data and own labels). */
export function makeEan13(body12: string): string {
  if (!/^\d{12}$/.test(body12)) throw new Error('EAN-13 body must be 12 digits');
  return `${body12}${gtinCheckDigit(body12)}`;
}
