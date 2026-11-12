'use client';

import { useRef, useState } from 'react';
import { uploadPhotoAction } from '@/app/actions';
import { shrinkImage as shrink } from '@/lib/shrink-image';
import { Icon } from './Icon';

export function PhotoButton({ receiptId, kind, label, onUploaded }: { receiptId: string; kind: 'DELIVERY_NOTE' | 'DAMAGE'; label: string; onUploaded: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.set('receiptId', receiptId);
      form.set('kind', kind);
      form.set('photo', new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }));
      const result = await uploadPhotoAction(form);
      if (result.ok && result.value) onUploaded(result.value);
      else if (!result.ok) setError(result.error);
    } catch {
      setError('Upload fehlgeschlagen – Verbindung prüfen und nochmals versuchen.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button type="button" className="btn-secondary w-full text-sm" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="camera" />
        {busy ? 'Lädt hoch …' : label}
      </button>
      {error && <p className="mt-1 text-xs text-danger-500">{error}</p>}
    </div>
  );
}
