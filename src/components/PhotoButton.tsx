'use client';

import { useRef, useState } from 'react';
import { uploadPhotoAction } from '@/app/actions';
import { Icon } from './Icon';

const MAX_EDGE = 1600;

/** Shrinks a photo on the phone before upload (≈200–400 KB instead of 3–6 MB). */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob) return blob;
  } catch {
    // Fall through: send the original if the browser cannot decode it here.
  }
  return file;
}

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
