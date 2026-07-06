// Hand-drawn fallback icons — plain SVG, no external dependency risk.
// These render whenever a champion/item/rune image isn't found in /public/assets.

export function IconMagnet({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 4v9a3 3 0 0 0 6 0V4" />
      <path d="M6 4h3M15 4h3" />
    </svg>
  );
}

export function IconWand({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2z" />
      <path d="M5 21l8-8 2 2-8 8z" />
    </svg>
  );
}

export function IconHeart({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21s-7.2-4.5-9.6-9.1A5.4 5.4 0 0 1 12 5a5.4 5.4 0 0 1 9.6 6.9C19.2 16.5 12 21 12 21z" />
    </svg>
  );
}

export function IconBoot({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 3h4v9l4 2h6v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6l5-2z" />
    </svg>
  );
}

export function IconGem({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12,2 19,9 12,22 5,9" />
    </svg>
  );
}

export function IconSkull({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6.5V20a1 1 0 0 0 1 1h1.5v-2h1v2h2v-2h1v2H17a1 1 0 0 0 1-1v-3.5c1.5-1.5 3-3.5 3-6.5a8 8 0 0 0-8-8z" />
      <circle cx="9" cy="10" r="1.5" fill="#04050c" />
      <circle cx="15" cy="10" r="1.5" fill="#04050c" />
    </svg>
  );
}

export function IconDagger({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v11" />
      <path d="M8 5h8" />
      <path d="M12 13l-2.5 7L12 22l2.5-2L12 13z" />
    </svg>
  );
}
