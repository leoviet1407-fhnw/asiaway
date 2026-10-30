import { photoSrcSet } from '../../lib/photo';

/**
 * A dish photograph at the size the screen needs.
 *
 * `sizes` says how wide the photo is drawn, so a phone downloads the 800 px copy
 * for a card and never the 1200 px one unless the screen can use it. Images
 * without variants fall back to a plain image of the stored path.
 */
export function DishPhoto({
  src,
  alt,
  sizes,
  className,
  eager = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  const srcSet = photoSrcSet(src);
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
    />
  );
  if (!srcSet) return img;

  return (
    <picture className="contents">
      <source type="image/webp" srcSet={srcSet} sizes={sizes} />
      {img}
    </picture>
  );
}
