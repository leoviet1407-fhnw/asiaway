'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../../lib/format';

interface Special {
  id: string;
  serviceDate: string;
  nameEn: string;
  nameDe: string;
  nameVi: string;
  descriptionEn: string;
  descriptionDe: string;
  descriptionVi: string;
  imageEtag: string;
  imageBytes: number;
  updatedAt: string;
}

const SPECIAL_PRICE_CENTS = 3350;

/** Longest edge after downscaling. Plenty for a phone, small in the database. */
const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.82;

/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * A phone camera produces 4–8 MB; that is far more detail than a menu card can
 * show, and it goes into the database and back out to every guest's phone. Done
 * here rather than on the server so there is no image library on the critical
 * path of a serverless deployment.
 *
 * If anything about this fails the original is uploaded unchanged — the size
 * limit on the server is the real guard.
 */
async function downscale(file: File): Promise<File> {
  try {
    if (!file.type.startsWith('image/')) return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * Setting the Saturday dish.
 *
 * Done weekly by restaurant staff on a tablet, so the screen defaults to the
 * Saturday being prepared for and shows what is already set — the question
 * being answered is almost always "is this week done yet?".
 */
export default function SaturdaySpecialsPage() {
  const [specials, setSpecials] = useState<Special[] | null>(null);
  const [serviceDate, setServiceDate] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionDe, setDescriptionDe] = useState('');
  const [descriptionVi, setDescriptionVi] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/waiter/specials');
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('This page could not be loaded.');
      return;
    }
    const data = await response.json();
    setSpecials(data.specials);
    setServiceDate((current) => current || data.suggestedDate);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Revoked when it changes, so picking several photos does not leak them all.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const existing = specials?.find((s) => s.serviceDate === serviceDate) ?? null;

  /** Fills the form from a Saturday already set, so it can be corrected. */
  function edit(special: Special) {
    setServiceDate(special.serviceDate);
    setNameEn(special.nameEn);
    setNameDe(special.nameDe);
    setNameVi(special.nameVi);
    setDescriptionEn(special.descriptionEn);
    setDescriptionDe(special.descriptionDe);
    setDescriptionVi(special.descriptionVi);
    setFile(null);
    setSaved(null);
    setError(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);

    try {
      const body = new FormData();
      body.set('serviceDate', serviceDate);
      body.set('nameEn', nameEn.trim());
      body.set('nameDe', nameDe.trim());
      body.set('nameVi', nameVi.trim());
      body.set('descriptionEn', descriptionEn.trim());
      body.set('descriptionDe', descriptionDe.trim());
      body.set('descriptionVi', descriptionVi.trim());
      if (file) body.set('image', await downscale(file));

      const response = await fetch('/api/waiter/specials', { method: 'POST', body });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.error?.message ?? 'The dish could not be saved.');
        return;
      }

      setSaved(`Saved for Saturday ${serviceDate}.`);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch {
      setError('No connection. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    serviceDate.length > 0 &&
    nameEn.trim().length > 0 &&
    nameDe.trim().length > 0 &&
    nameVi.trim().length > 0 &&
    (file !== null || existing !== null);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 pb-24">
      <Link href="/waiter" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Dashboard
      </Link>

      <h1 className="h-section">Saturday dish</h1>
      <p className="-mt-2 text-sm text-ink-muted">
        Shown to guests on Saturdays only, at {formatMoney(SPECIAL_PRICE_CENTS)}. Without a photo
        and a name for that Saturday, nothing is shown at all.
      </p>

      <section className="card space-y-3 p-4">
        <div>
          <label htmlFor="date" className="mb-1 block h-label">
            Which Saturday
          </label>
          <input
            id="date"
            type="date"
            className="field"
            value={serviceDate}
            onChange={(e) => {
              setServiceDate(e.target.value);
              setSaved(null);
            }}
          />
          {existing && (
            <p className="mt-1 text-sm text-warn-500">
              This Saturday is already set — saving replaces it.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="photo" className="mb-1 block h-label">
            Photo of the dish
          </label>
          <input
            id="photo"
            ref={fileInput}
            type="file"
            accept="image/*"
            className="field"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setSaved(null);
            }}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Taken on a phone is fine — it is shrunk before uploading.
            {existing && !file && ' Leave empty to keep the photo already set.'}
          </p>

          {(previewUrl || existing) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                previewUrl ??
                `/api/menu/specials/${existing!.serviceDate}/image?v=${existing!.imageEtag}`
              }
              alt={previewUrl ? 'The photo about to be uploaded' : 'The photo already set'}
              className="mt-2 h-48 w-full rounded-xl object-cover"
            />
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="h-label mb-1">Name of the dish</legend>
          {/* All three, because a guest reading in German should not be shown
              an English name they cannot match to the printed menu. */}
          <input
            className="field"
            placeholder="English"
            aria-label="Name in English"
            maxLength={120}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
          <input
            className="field"
            placeholder="Deutsch"
            aria-label="Name in German"
            maxLength={120}
            value={nameDe}
            onChange={(e) => setNameDe(e.target.value)}
          />
          <input
            className="field"
            placeholder="Tiếng Việt"
            aria-label="Name in Vietnamese"
            maxLength={120}
            value={nameVi}
            onChange={(e) => setNameVi(e.target.value)}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="h-label mb-1">Description (optional)</legend>
          <textarea
            className="field min-h-16"
            placeholder="English"
            aria-label="Description in English"
            maxLength={600}
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
          />
          <textarea
            className="field min-h-16"
            placeholder="Deutsch"
            aria-label="Description in German"
            maxLength={600}
            value={descriptionDe}
            onChange={(e) => setDescriptionDe(e.target.value)}
          />
          <textarea
            className="field min-h-16"
            placeholder="Tiếng Việt"
            aria-label="Description in Vietnamese"
            maxLength={600}
            value={descriptionVi}
            onChange={(e) => setDescriptionVi(e.target.value)}
          />
        </fieldset>
      </section>

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-700" role="status">
          {saved}
        </p>
      )}

      <button className="btn-primary w-full" disabled={busy || !canSave} onClick={() => void save()}>
        {busy
          ? 'Saving…'
          : !serviceDate
            ? 'Pick a Saturday'
            : !file && !existing
              ? 'Add a photo first'
              : existing
                ? 'Replace this Saturday’s dish'
                : 'Save this Saturday’s dish'}
      </button>

      <section className="card p-4">
        <h2 className="mb-2 h-label">Saturdays already set</h2>
        {!specials && <p className="text-sm text-ink-muted">Loading…</p>}
        {specials?.length === 0 && (
          <p className="text-sm text-ink-muted">None yet. The next Saturday is above.</p>
        )}
        <ul className="space-y-2">
          {specials?.map((special) => (
            <li key={special.id} className="flex items-center gap-3 border-b border-ink/5 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/menu/specials/${special.serviceDate}/image?v=${special.imageEtag}`}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{special.nameEn}</span>
                <span className="block text-xs text-ink-muted">
                  {special.serviceDate} · {Math.round(special.imageBytes / 1024)} KB
                </span>
              </span>
              <button
                type="button"
                className="min-h-tap px-2 text-sm font-semibold text-brand-700"
                onClick={() => edit(special)}
              >
                Change
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
