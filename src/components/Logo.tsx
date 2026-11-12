import { withBase } from '@/lib/base-path';

/** The AsiaWay logo. `variant="white"` for dark backgrounds, "red" for light ones. */
export function Logo({ variant = 'red', className = 'h-8' }: { variant?: 'red' | 'white'; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={withBase(variant === 'white' ? '/brand/asiaway-logo-white.png' : '/brand/asiaway-logo.png')}
      alt="AsiaWay"
      width={512}
      height={133}
      className={`w-auto ${className}`}
    />
  );
}
