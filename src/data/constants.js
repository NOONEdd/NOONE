import {
  Sparkles,
  Shield,
  Swords,
  Target,
  Lightbulb,
  Flame,
  Castle,
  Trees,
  Zap,
  Crosshair,
  CircleHelp,
} from "lucide-react";

import {
  IconMagnet,
  IconWand,
  IconHeart,
  IconBoot,
  IconGem,
  IconSkull,
  IconDagger,
} from "../components/icons.jsx";

import { defineRegistry, deriveMap, lookupDisplay } from "../lib/displayRegistry.js";

// ============================================================
// DISPLAY REGISTRIES -- one entry per value, icon + color + order together
// ============================================================
//
// Each registry below is the SINGLE definition of how one data field is shown. The older
// separate exports (ROLE_ICONS / ROLE_COLORS, ITEM_ICONS / ITEM_COLORS / ITEM_CATEGORIES,
// RUNE_ICONS / RUNE_COLORS / RUNE_PATHS, TIER_ORDER / TIER_SELECT / TIER_COLORS) are DERIVED
// from these, so an icon and its color can no longer be added to one map and forgotten in
// the other (exactly how "Marksman Support" once reached the page with no icon).
//
// Adding a value: add ONE entry here. Rendering code should resolve values through
// roleDisplay() / itemCategoryDisplay() / runePathDisplay() / tierDisplay() below -- they
// always return a renderable icon and a usable color, and report (once) any value with no
// valid entry. tests/mappingIntegrity.test.mjs fails if the shipped data uses a value that
// has no complete entry here.

/** Neutral fallback for a value no registry entry covers: a question-mark icon that NO
 *  registry entry uses (so a fallback can never be mistaken on screen for, say, a Warden's
 *  Shield) and the site's dim text color. The value's own text (the role / category name)
 *  is still shown next to it; the miss is reported once and fails the mapping tests. */
export const FALLBACK_DISPLAY = Object.freeze({ icon: CircleHelp, color: "var(--text-dimmer)" });

// ============================================================
// TIER LIST
// ============================================================

// Display order = tier-row order on the boards. `color` is the badge / row color.
export const TIER_REGISTRY = defineRegistry({
  name: "tier",
  description: "Tier placement (champions, items, runes, Coach Mode overrides)",
  requires: ["color"],
  fallback: FALLBACK_DISPLAY,
  entries: [
    ["S", { color: "#f3c969" }],
    ["A", { color: "#ff5fc1" }],
    ["B", { color: "#9b6bff" }],
    ["C", { color: "#1fd0ff" }],
    ["D", { color: "#5c6182" }],
    ["Unranked", { color: "#3a3f5c" }],
  ],
});

export const TIER_ORDER = Object.freeze([...TIER_REGISTRY.keys]);

// The Coach Mode tier <select>: "Unranked" first (the default for a new entry), then S..D.
export const TIER_SELECT = Object.freeze([
  ...TIER_REGISTRY.keys.filter((t) => t === "Unranked"),
  ...TIER_REGISTRY.keys.filter((t) => t !== "Unranked"),
]);

export const TIER_COLORS = deriveMap(TIER_REGISTRY, "color");


// ============================================================
// CHAMPION ROLES
// ============================================================

// The champion `role` field carries TWO vocabularies, partitioned by Academy coverage
// (src/data/champions.js isAcademyCovered): the 38 coached champions use an Academy
// support archetype (group "support"); the roster-only champions added for the Matchup
// picker use their conventional Wild Rift lane (group "lane") -- see the comment above
// that block in champions.js. `group` records which vocabulary a value belongs to so the
// validator can flag a champion filed under the wrong one; it changes nothing on screen.
export const ROLE_REGISTRY = defineRegistry({
  name: "championRole",
  description: "Champion role (Academy support archetype or roster lane tag)",
  fallback: FALLBACK_DISPLAY,
  entries: [
    ["Enchanter", { icon: Sparkles, color: "#9b6bff", group: "support" }],
    ["Catcher", { icon: IconMagnet, color: "#f3c969", group: "support" }],
    ["Assassin Catcher", { icon: IconDagger, color: "#ff6b6b", group: "support" }],
    ["Warden", { icon: Shield, color: "#1fd0ff", group: "support" }],
    ["Mage Support", { icon: IconWand, color: "#3df0d8", group: "support" }],
    ["Marksman Support", { icon: Crosshair, color: "#ff6b6b", group: "support" }],
    ["Off-Meta Flex", { icon: Swords, color: "#ff5fc1", group: "support" }],

    ["Baron", { icon: Castle, color: "#f3c969", group: "lane" }],
    ["Jungle", { icon: Trees, color: "#3df0d8", group: "lane" }],
    ["Mid", { icon: Zap, color: "#ff5fc1", group: "lane" }],
    ["Dragon", { icon: Crosshair, color: "#ff6b6b", group: "lane" }],
  ],
});

export const ROLE_ICONS = deriveMap(ROLE_REGISTRY, "icon");
export const ROLE_COLORS = deriveMap(ROLE_REGISTRY, "color");


// ============================================================
// ITEM CATEGORIES
// ============================================================

// Display order = filter-pill order on the Item Tier List.
export const ITEM_CATEGORY_REGISTRY = defineRegistry({
  name: "itemCategory",
  description: "Item category",
  fallback: FALLBACK_DISPLAY,
  entries: [
    ["Support", { icon: IconHeart, color: "#ff5fc1" }],
    ["Defense", { icon: Shield, color: "#1fd0ff" }],
    ["Boots", { icon: IconBoot, color: "#f3c969" }],
    ["Enchant", { icon: IconWand, color: "#9b6bff" }],
    ["Magic", { icon: Flame, color: "#3df0d8" }],
    ["Physical", { icon: Swords, color: "#ff6b6b" }],
  ],
});

export const ITEM_ICONS = deriveMap(ITEM_CATEGORY_REGISTRY, "icon");
export const ITEM_COLORS = deriveMap(ITEM_CATEGORY_REGISTRY, "color");
export const ITEM_CATEGORIES = Object.freeze([...ITEM_CATEGORY_REGISTRY.keys]);


// ============================================================
// RUNE PATHS
// ============================================================

// Display order = filter-pill order on the Rune Tier List. Wild Rift has no Sorcery path.
export const RUNE_PATH_REGISTRY = defineRegistry({
  name: "runePath",
  description: "Rune path",
  fallback: FALLBACK_DISPLAY,
  entries: [
    ["Keystone", { icon: IconGem, color: "#f3c969" }],
    ["Precision", { icon: Target, color: "#1fd0ff" }],
    ["Domination", { icon: IconSkull, color: "#ff6b6b" }],
    ["Resolve", { icon: Shield, color: "#9b6bff" }],
    ["Inspiration", { icon: Lightbulb, color: "#ff5fc1" }],
  ],
});

export const RUNE_ICONS = deriveMap(RUNE_PATH_REGISTRY, "icon");
export const RUNE_COLORS = deriveMap(RUNE_PATH_REGISTRY, "color");
export const RUNE_PATHS = Object.freeze([...RUNE_PATH_REGISTRY.keys]);


// ============================================================
// SAFE RESOLVERS -- what rendering code should call
// ============================================================

// `context` is optional diagnostic detail for the one-time warning, e.g.
// { dataset: "champions", entityId: c.id, entityName: c.name }.
export const roleDisplay = (role, context) => lookupDisplay(ROLE_REGISTRY, role, context);
export const itemCategoryDisplay = (category, context) => lookupDisplay(ITEM_CATEGORY_REGISTRY, category, context);
export const runePathDisplay = (path, context) => lookupDisplay(RUNE_PATH_REGISTRY, path, context);
export const tierDisplay = (tier, context) => lookupDisplay(TIER_REGISTRY, tier, context);

/** Every registry, for the validator (src/lib/mappingValidation.js) and tests. */
export const DISPLAY_REGISTRIES = Object.freeze({
  tier: TIER_REGISTRY,
  championRole: ROLE_REGISTRY,
  itemCategory: ITEM_CATEGORY_REGISTRY,
  runePath: RUNE_PATH_REGISTRY,
});


// ============================================================
// SUMMONER SPELLS
// ============================================================

// Standard Wild Rift summoner spells.
// Image lookup key: "s:{id}" -> /assets/spells/{id}.{ext}

export const SUMMONER_SPELLS = [
  "flash",
  "ignite",
  "heal",
  "exhaust",
  "barrier",
  "ghost",
  "cleanse",
  "smite",
  "teleport",
  "mark",
];


// ============================================================
// NAVIGATION
// ============================================================

// /admin is deliberately excluded from public navigation.
// It is accessible only through direct navigation to #/admin.

export const NAV_LINKS = [
  {
    label: "Home",
    path: "/",
    page: "home",
  },
  {
    label: "AI Coach",
    path: "/ai-coach",
    page: "ai-coach",
  },
  {
    label: "Champions",
    path: "/tierlist",
    page: "tierlist",
  },
  {
    label: "Items",
    path: "/items",
    page: "items",
  },
  {
    label: "Runes",
    path: "/runes",
    page: "runes",
  },
  {
    label: "Guides",
    path: "/guides",
    page: "guides",
  },
  {
    label: "Patch Notes",
    path: "/patch-notes",
    page: "patch-notes",
  },
  {
    label: "Coaching",
    path: "/coaching",
    page: "coaching",
  },
];