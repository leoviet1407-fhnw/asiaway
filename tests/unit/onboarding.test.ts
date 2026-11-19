import { describe, expect, it } from 'vitest';
import { formatIban, isValidAhvNumber, isValidBirthDate, isValidPhone, isValidSwissIban, validateOnboarding, type OnboardingInput } from '@/domain/onboarding';

const ok: OnboardingInput = {
  privateEmail: 'ivy@gmail.com',
  mobile: '079 123 45 67',
  birthDate: '1995-04-12',
  street: 'Birchstrasse 12',
  zip: '8050',
  city: 'Zürich',
  nationality: '',
  iban: 'CH93 0076 2011 6238 5295 7',
  ahvNumber: '',
  emergencyName: '',
  emergencyPhone: '',
};
const today = '2026-11-13';

describe('onboarding validation', () => {
  it('accepts a complete form with only the required fields', () => {
    expect(validateOnboarding(ok, today)).toEqual({});
  });
  it('checks the IBAN checksum and that it is Swiss', () => {
    expect(isValidSwissIban('CH9300762011623852957')).toBe(true);
    expect(isValidSwissIban('ch93 0076 2011 6238 5295 7')).toBe(true);
    expect(isValidSwissIban('CH9300762011623852958')).toBe(false); // wrong check
    expect(isValidSwissIban('DE89370400440532013000')).toBe(false); // valid but German
    expect(formatIban('CH9300762011623852957')).toBe('CH93 0076 2011 6238 5295 7');
  });
  it('checks the AHV number', () => {
    expect(isValidAhvNumber('756.9217.0769.85')).toBe(true);
    expect(isValidAhvNumber('756.9217.0769.86')).toBe(false);
    expect(isValidAhvNumber('123.4567.8901.23')).toBe(false);
  });
  it('checks phone numbers and birth dates', () => {
    expect(isValidPhone('+41 79 123 45 67')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidBirthDate('1995-02-30', today)).toBe(false); // not a real date
    expect(isValidBirthDate('2020-01-01', today)).toBe(false); // too young
    expect(isValidBirthDate('2012-11-14', today)).toBe(false); // turns 14 tomorrow
    expect(isValidBirthDate('2012-11-13', today)).toBe(true);
  });
  it('reports each wrong field, and wants name and phone of the emergency contact together', () => {
    const e = validateOnboarding({ ...ok, privateEmail: 'x', zip: '80', iban: 'CH00', emergencyName: 'Mama' }, today);
    expect(Object.keys(e).sort()).toEqual(['emergencyPhone', 'iban', 'privateEmail', 'zip']);
  });
});
