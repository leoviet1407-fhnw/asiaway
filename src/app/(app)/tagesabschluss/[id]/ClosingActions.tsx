'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { shrinkImage } from '@/lib/shrink-image';
import { closingStepAction, uploadClosingPhotoAction } from '../../../actions';

/** Photos of the paper form and of the POS report, and the orderer's approval. */
export function ClosingActions({ closingId, approved, canApprove, photos, photoBase }: { closingId: string; approved: boolean; canApprove: boolean; photos: string[]; photoBase: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await shrinkImage(file);
      const form = new FormData();
      form.set('closingId', closingId);
      form.set('photo', new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }));
      const result = await uploadClosingPhotoAction(form);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch {
      setError('Upload fehlgeschlagen – Verbindung prüfen und nochmals versuchen.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const step = (which: 'approve' | 'reopen', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const result = await closingStepAction(closingId, which);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg">Fotos</h2>
      <p className="text-sm text-charcoal-muted">Foto vom ausgefüllten Formular und vom Kassenbericht (z. B. Tagesabschluss-Beleg des POS).</p>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((id) => (
            <a key={id} href={`${photoBase}/${id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-btn border border-surface-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${photoBase}/${id}`} alt="Abschluss-Foto" className="aspect-square w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {!approved && (
        <>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="camera" />
            {busy ? 'Lädt hoch …' : 'Foto hinzufügen'}
          </button>
        </>
      )}
      {error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}
      {canApprove && (
        <div className="border-t border-surface-line pt-3">
          {approved ? (
            <button className="btn-secondary" disabled={pending} onClick={() => step('reopen', 'Abschluss wieder öffnen? Die Mitarbeiter können ihn dann ändern.')}>
              Wieder öffnen
            </button>
          ) : (
            <button className="btn-primary" disabled={pending} onClick={() => step('approve', 'Abschluss freigeben und sperren?')}>
              {pending ? '…' : 'Freigeben'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
