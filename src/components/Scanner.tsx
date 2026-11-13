'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '@/i18n/client';

/**
 * Phone-camera barcode scanner.
 *
 * Uses the browser's own BarcodeDetector where it exists (Chrome on Android,
 * recent Safari), and otherwise loads ZXing — only then, so phones with the
 * native detector never download it.
 */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'];

type Engine = 'native' | 'zxing';

export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  // Stop the camera while the app is in the background, to save battery.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [stop]);

  const start = async () => {
    setMessage(null);
    setState('starting');
    const video = videoRef.current;
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setMessage(t('Dieser Browser kann nicht auf die Kamera zugreifen. Bitte Barcode unten eintippen.'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (error) {
      setState('error');
      setMessage(
        (error as DOMException)?.name === 'NotAllowedError'
          ? t('Kamera-Zugriff verweigert. In den Browser-Einstellungen erlauben oder Barcode eintippen.')
          : t('Kamera konnte nicht gestartet werden. Barcode bitte eintippen.'),
      );
      return;
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play().catch(() => undefined);
    const stopStream = () => {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };

    const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    let formats: string[] = [];
    if (Native) {
      try {
        const supported = (await Native.getSupportedFormats?.()) ?? WANTED;
        formats = WANTED.filter((f) => supported.includes(f));
      } catch {
        formats = [];
      }
    }

    if (Native && formats.length > 0) {
      const detector = new Native({ formats });
      let running = true;
      let last = 0;
      const tick = async (time: number) => {
        if (!running) return;
        if (time - last > 120 && video.readyState >= 2) {
          last = time;
          try {
            for (const code of await detector.detect(video)) onCodeRef.current(code.rawValue);
          } catch {
            // A frame that cannot be read is skipped.
          }
        }
        requestAnimationFrame((t) => void tick(t));
      };
      requestAnimationFrame((t) => void tick(t));
      stopRef.current = () => {
        running = false;
        stopStream();
      };
      setEngine('native');
    } else {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.QR_CODE,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) onCodeRef.current(result.getText());
        });
        stopRef.current = () => {
          controls.stop();
          stopStream();
        };
        setEngine('zxing');
      } catch (error) {
        console.error('[scanner] zxing failed', error);
        stopStream();
        setState('error');
        setMessage(t('Scanner konnte nicht geladen werden. Barcode bitte eintippen.'));
        return;
      }
    }
    setState('running');
  };

  return (
    <div className="overflow-hidden rounded-btn bg-navy">
      <div className={`relative w-full ${state === 'running' ? 'aspect-[4/3] max-h-[42vh] sm:aspect-video' : 'h-32'}`}>
        <video ref={videoRef} className={`h-full w-full object-cover ${state === 'running' ? '' : 'opacity-0'}`} muted playsInline />
        {state === 'running' && (
          <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-24 -translate-y-1/2 rounded-btn border-2 border-white/80 shadow-[0_0_0_9999px_rgba(9,20,29,0.35)]">
            <div className="absolute inset-x-2 top-1/2 h-0.5 bg-brand-500/90" />
          </div>
        )}
        {state !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
            <button type="button" className="btn-primary px-6 text-base" onClick={() => void start()} disabled={state === 'starting'}>
              <Icon name="camera" />
              {state === 'starting' ? t('Kamera startet …') : t('Kamera starten')}
            </button>
            {message && <p className="max-w-xs text-sm text-white/80">{message}</p>}
          </div>
        )}
      </div>
      {state === 'running' && (
        <div className="flex items-center justify-between px-3 py-1.5 text-xs text-white/70">
          <span>{engine === 'native' ? t('Scanner aktiv') : t('Scanner aktiv (ZXing)')} {t('– Barcode in den Rahmen halten')}</span>
          <button type="button" className="font-semibold text-white" onClick={stop}>
            {t('Kamera aus')}
          </button>
        </div>
      )}
    </div>
  );
}
