import { Shield } from "lucide-react";
import { candidatePaths } from "../utils/images.js";
import SmartImage from "./SmartImage.jsx";
import { ROLE_ICONS, ROLE_COLORS, ITEM_ICONS, ITEM_COLORS, RUNE_ICONS, RUNE_COLORS } from "../data/constants.js";

const TYPE_PREFIX = { champion: "c", item: "i", rune: "r" };

/**
 * Champion/Item/Rune image for a Patch Intelligence report entry
 * (src/pages/AdminPage.jsx, src/pages/PatchIntelligencePage.jsx) --
 * reuses the EXACT same mechanism src/components/RankChip.jsx already
 * uses for tier lists (candidatePaths() + <SmartImage/>), not a second
 * asset system. Two inputs only, both already resolved server-side and
 * never AI-supplied:
 *   - `entityId`: functions/_lib/patchIntelligence.js's own
 *     normalizePatchIntelReport() already resolves every reported
 *     champion/item/rune NAME back to a real Academy id (or null if it
 *     didn't match anything Academy tracks) -- see that file's
 *     resolveEntityId(). This component only ever receives that
 *     already-verified id, never a raw AI string, and never anything
 *     resembling a URL -- there is no code path here that could render
 *     an AI-supplied image location even if a report somehow contained
 *     one.
 *   - `roster`: the site's own effective champion/item/rune list (same
 *     one src/App.jsx already computes for the rest of the site) --
 *     used only to look up the matched entity's role/category/path, so
 *     the SAME fallback icon + accent color conventions already used
 *     everywhere else on the site (RankChip.jsx's ROLE_ICONS/ITEM_ICONS/
 *     RUNE_ICONS) apply here too.
 *
 * `entityId` may be null (the AI mentioned something Academy doesn't
 * track, or a name that didn't resolve) -- renders just the generic
 * fallback icon in that case, no image probe attempted, never a broken-
 * image icon.
 */
export default function EntityImage({ entityType, entityId, entityName, roster }) {
  const prefix = TYPE_PREFIX[entityType];
  const entry = entityId && roster ? roster.find((r) => r.id === entityId) : null;

  let Icon = Shield;
  let accent = "var(--text-dimmer)";
  if (entityType === "champion") {
    Icon = (entry && ROLE_ICONS[entry.role]) || Shield;
    accent = (entry && ROLE_COLORS[entry.role]) || accent;
  } else if (entityType === "item") {
    Icon = (entry && ITEM_ICONS[entry.category]) || Shield;
    accent = (entry && ITEM_COLORS[entry.category]) || accent;
  } else if (entityType === "rune") {
    Icon = (entry && RUNE_ICONS[entry.path]) || Shield;
    accent = (entry && RUNE_COLORS[entry.path]) || accent;
  }

  const paths = prefix && entityId ? candidatePaths(`${prefix}:${entityId}`) : [];

  return (
    <div className="entity-image-wrap" style={{ "--accent": accent }}>
      <Icon size={20} />
      {paths.length > 0 && <SmartImage basePath={paths} alt={entityName || ""} className="entity-image-portrait" />}
    </div>
  );
}
