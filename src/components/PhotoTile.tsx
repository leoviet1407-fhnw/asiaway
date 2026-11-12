import Link from 'next/link';

interface Props {
  href: string;
  title: string;
  /** Small red line under the title, as on asiaway.ch (Vietnamese). */
  accent: string;
  text?: string;
  image?: string;
  external?: boolean;
  size?: 'hero' | 'tile';
  badge?: number;
}

/** A full-bleed photo card with a dark fade, white title and red accent – the look of asiaway.ch. */
export function PhotoTile({ href, title, accent, text, image, external, size = 'tile', badge }: Props) {
  const inner = (
    <>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading={size === 'hero' ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/55 to-navy/10" />
      {badge ? <span className="absolute right-3 top-3 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold text-white">{badge}</span> : null}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className={`font-bold text-white ${size === 'hero' ? 'text-3xl' : 'text-xl'}`}>{title}</span>
          <span className="text-sm font-medium text-[#ff7a7f] [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">{accent}</span>
        </div>
        {text ? <p className="mt-0.5 text-sm text-white/70">{text}</p> : null}
      </div>
    </>
  );
  const className = `group relative block overflow-hidden rounded-btn bg-navy ${size === 'hero' ? 'aspect-[16/10] sm:aspect-[16/6]' : 'aspect-[4/3]'}`;
  return external ? (
    <a href={href} className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}
