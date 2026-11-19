/** Personal details of a staff member: the fields and their validation (pure, no I/O). */

export interface OnboardingInput {
  privateEmail: string;
  mobile: string;
  /** YYYY-MM-DD */
  birthDate: string;
  street: string;
  zip: string;
  city: string;
  nationality: string;
  iban: string;
  ahvNumber: string;
  emergencyName: string;
  emergencyPhone: string;
}

export type OnboardingField = keyof OnboardingInput;
export type OnboardingErrors = Partial<Record<OnboardingField, string>>;

/** Strips spaces and upper-cases an IBAN. */
export const normalizeIban = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

/** "CH93 0076 2011 6238 5295 7" – groups of four, for display. */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();

/** Mod-97 check of an IBAN (ISO 13616). */
export function isValidIbanChecksum(iban: string): boolean {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** Swiss payroll needs a Swiss (or Liechtenstein) account: CH/LI, 21 characters. */
export function isValidSwissIban(raw: string): boolean {
  const s = normalizeIban(raw);
  return /^(CH|LI)\d{19}$/.test(s) && isValidIbanChecksum(s);
}

/** AHV number 756.XXXX.XXXX.XC with the EAN-13 check digit. */
export function isValidAhvNumber(raw: string): boolean {
  const digits = raw.replace(/[.\s]/g, '');
  if (!/^756\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

export const formatAhv = (raw: string): string => {
  const d = raw.replace(/[.\s]/g, '');
  return d.length === 13 ? `${d.slice(0, 3)}.${d.slice(3, 7)}.${d.slice(7, 11)}.${d.slice(11)}` : raw.trim();
};

/** A phone number people really type: +41 79 123 45 67, 079 123 45 67, 0041 … */
export function isValidPhone(raw: string): boolean {
  if (!/^[+\d][\d\s()/.-]*$/.test(raw.trim())) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

export const isValidEmail = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());

/** A real calendar date in the past, for a person between 14 and 100 years old. */
export function isValidBirthDate(iso: string, today: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age >= 14 && age <= 100;
}

/**
 * Checks the whole form. Returns the German message per wrong field (empty = ok).
 * Required: private e-mail, mobile, birth date, address, IBAN. Optional: nationality,
 * AHV number, emergency contact (but a name needs a phone number and vice versa).
 */
export function validateOnboarding(input: OnboardingInput, today: string): OnboardingErrors {
  const e: OnboardingErrors = {};
  if (!isValidEmail(input.privateEmail)) e.privateEmail = 'Bitte eine gültige private E-Mail-Adresse eingeben.';
  if (!isValidPhone(input.mobile)) e.mobile = 'Bitte eine gültige Handynummer eingeben (z. B. 079 123 45 67).';
  if (!isValidBirthDate(input.birthDate, today)) e.birthDate = 'Bitte ein gültiges Geburtsdatum eingeben.';
  if (input.street.trim().length < 3) e.street = 'Bitte Strasse und Nummer eingeben.';
  if (!/^\d{4}$/.test(input.zip.trim())) e.zip = 'Die PLZ hat 4 Ziffern.';
  if (input.city.trim().length < 2) e.city = 'Bitte den Ort eingeben.';
  if (!isValidSwissIban(input.iban)) e.iban = 'Bitte eine gültige Schweizer IBAN eingeben (CH… mit 21 Zeichen).';
  if (input.ahvNumber.trim() && !isValidAhvNumber(input.ahvNumber)) e.ahvNumber = 'Die AHV-Nummer ist ungültig (756.xxxx.xxxx.xx).';
  const hasName = input.emergencyName.trim() !== '';
  const hasPhone = input.emergencyPhone.trim() !== '';
  if (hasName !== hasPhone) e[hasName ? 'emergencyPhone' : 'emergencyName'] = 'Für den Notfallkontakt bitte Name und Telefonnummer angeben.';
  else if (hasPhone && !isValidPhone(input.emergencyPhone)) e.emergencyPhone = 'Die Telefonnummer ist ungültig.';
  return e;
}

/** Trims and normalises the values that are stored. */
export function cleanOnboarding(input: OnboardingInput): OnboardingInput {
  return {
    privateEmail: input.privateEmail.trim().toLowerCase(),
    mobile: input.mobile.trim(),
    birthDate: input.birthDate,
    street: input.street.trim(),
    zip: input.zip.trim(),
    city: input.city.trim(),
    nationality: input.nationality.trim(),
    iban: normalizeIban(input.iban),
    ahvNumber: input.ahvNumber.trim() ? formatAhv(input.ahvNumber) : '',
    emergencyName: input.emergencyName.trim(),
    emergencyPhone: input.emergencyPhone.trim(),
  };
}
