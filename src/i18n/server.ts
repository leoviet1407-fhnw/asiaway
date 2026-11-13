import { cookies } from 'next/headers';
import { LANG_COOKIE, makeT, normalizeLang, type Lang, type TFunction } from './translate';

/** The language of this request (cookie), German unless the user switched. */
export async function getLang(): Promise<Lang> {
  return normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getT(): Promise<TFunction> {
  return makeT(await getLang());
}
