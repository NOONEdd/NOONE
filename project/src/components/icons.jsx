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

// Contact-link brand marks — Discord and Telegram, simplified to their
// widely-recognized silhouettes (same "plain SVG, no external dependency"
// approach as the icons above, currentColor so they match whatever text
// color surrounds them rather than hardcoding brand colors).
export function IconDiscord({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.245.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function IconTelegram({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.8 3.2L2.3 11c-1 .4-1 1.7.1 2l4.4 1.4 1.6 5.2c.2.6 1 .8 1.5.3l2.3-2.4 4.4 3.2c.8.6 1.9.1 2.1-.8l3.4-15.1c.2-1-.8-1.9-1.8-1.5z" />
    </svg>
  );
}
