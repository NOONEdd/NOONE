import { Shield } from "lucide-react";
import { candidatePaths, findCanonicalId } from "../utils/images.js";
import SmartImage from "./SmartImage.jsx";
import { ROLE_ICONS, ROLE_COLORS, ITEM_ICONS, ITEM_COLORS, RUNE_ICONS, RUNE_COLORS } from "../data/constants.js";

const TYPE_PREFIX = { champion: "c", item: "i", rune: "r" };

/**
 * Champion/Item/Rune image for a Patch Intelligence report entry
 * (src/pages/AdminPage.jsx, src/pages/PatchIntelligencePage.jsx) --
 * reuses the EXACT SAME mechanism the rest of the site already uses for
 * every other entity image, at BOTH of its steps, not a second asset
 * system:
 *   1. Name -> Academy id: src/utils/images.js's findCanonicalId(), the
 *      same free-text-name resolver src/components/BuildBoard.jsx /
 *      BuildList.jsx / BuildEditor.jsx / ItemRunePicker.jsx already use
 *      to turn a hand-written Coach Mode build/rune name into a real id.
 *   2. Id -> image: candidatePaths() + <SmartImage/>, the same pair
 *      src/components/RankChip.jsx already uses for tier lists.
 * `entityName` is the only thing this ever resolves from -- always the
 * AI's raw extracted text (functions/_lib/patchIntelligence.js never
 * asks the AI for an id or a URL, only ever a name) -- and resolution
 * happens HERE, live, on every render, against `roster` (the site's own
 * current champion/item/rune list, the same one src/App.jsx already
 * computes for the rest of the site). That's deliberate, not just
 * "simpler": a report generated before some past matching fix (or
 * naming a genuine edge case) self-heals the moment the underlying
 * data/resolver becomes able to match it, exactly like every other
 * image on the site already behaves -- no report ever needs to be
 * regenerated just because name resolution got better. There is no code
 * path here that could render an AI-supplied image location even if a
 * report somehow contained one.
 *
 * `roster` is also used to look up the matched entity's role/category/
 * path, so the SAME fallback icon + accent color conventions already
 * used everywhere else on the site (RankChip.jsx's ROLE_ICONS/
 * ITEM_ICONS/RUNE_ICONS) apply here too.
 *
 * If `entityName` doesn't resolve to anything in `roster` (the AI
 * mentioned something Academy doesn't track, or a name that doesn't
 * match), this renders just the generic fallback icon -- no image probe
 * attempted, never a broken-image icon.
 */
export default function EntityImage({ entityType, entityName, roster }) {
  const prefix = TYPE_PREFIX[entityType];
  const rosterList = roster || [];
  const rawId = entityName ? findCanonicalId(entityName, rosterList) : null;
  // findCanonicalId() always returns SOMETHING (a slugify guess when
  // nothing matches) -- only trust it as a real entity when it actually
  // names something in the roster, same "no guessing" contract
  // patchIntelligence.js's own resolveEntityId() already enforces
  // server-side.
  const entry = rawId ? rosterList.find((r) => r.id === rawId) : null;
  const entityId = entry ? entry.id : null;

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
