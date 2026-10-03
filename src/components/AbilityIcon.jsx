import { useState } from "react";
import { Sparkles } from "lucide-react";
import { resolveAbilityIcon } from "../data/abilityAssets.js";

/**
 * Icon beside a Riot ability heading in Patch Notes (the ability counterpart of EntityImage's champion icon).
 * The icon is decoration only -- the heading and the change text next to it never depend on it:
 *   - no file for this champion + heading           -> neutral placeholder glyph (nothing is requested)
 *   - a file that was indexed but fails to load      -> the same placeholder (onError), never a broken-image icon
 * Resolution uses Riot's own heading (and the parser's slot-free ability name), never a guessed Q/W/E/R; see src/lib/abilityIcons.js.
 */
export default function AbilityIcon({ championId, sourceHeading, abilityName }) {
  const hit = resolveAbilityIcon(championId, { sourceHeading, abilityName });
  const [failed, setFailed] = useState(false);
  if (hit && !failed) return <img className="ability-icon" src={hit.src} alt="" aria-hidden="true" loading="lazy" onError={() => setFailed(true)} />;
  return <span className="ability-icon ability-icon-fallback" aria-hidden="true"><Sparkles size={13} /></span>;
}
