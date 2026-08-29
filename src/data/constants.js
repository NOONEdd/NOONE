import { Sparkles, Shield, Swords, Target, Lightbulb, Flame, Castle, Trees, Zap, Crosshair } from "lucide-react";
import { IconMagnet, IconWand, IconHeart, IconBoot, IconGem, IconSkull, IconDagger } from "../components/icons.jsx";

export const TIER_ORDER = ["S", "A", "B", "C", "D", "Unranked"];
export const TIER_SELECT = ["Unranked", "S", "A", "B", "C", "D"];
export const TIER_COLORS = { S: "#f3c969", A: "#ff5fc1", B: "#9b6bff", C: "#1fd0ff", D: "#5c6182", Unranked: "#3a3f5c" };

// Enchanter..."Off-Meta Flex" are Academy's own Support sub-roles (the
// original 36-champion roster, unchanged). Baron/Jungle/Mid/Dragon are
// conventional primary-lane tags added for the Phase 3 roster expansion
// (src/data/champions.js) -- Wild Rift's own lane names -- used only for
// this same icon/accent-color/filter-tag purpose, not a support-meta
// judgment. Every one of RankChip.jsx/EntityImage.jsx destructures
// ROLE_ICONS[role] directly with no fallback Icon component, so any role
// value actually used in champions.js MUST have an entry here or that
// champion's chip throws instead of rendering.
export const ROLE_ICONS = { Enchanter: Sparkles, Catcher: IconMagnet, "Assassin Catcher": IconDagger, Warden: Shield, "Mage Support": IconWand, "Off-Meta Flex": Swords, Baron: Castle, Jungle: Trees, Mid: Zap, Dragon: Crosshair };
export const ROLE_COLORS = { Enchanter: "#9b6bff", Catcher: "#f3c969", "Assassin Catcher": "#ff6b6b", Warden: "#1fd0ff", "Mage Support": "#3df0d8", "Off-Meta Flex": "#ff5fc1", Baron: "#f3c969", Jungle: "#3df0d8", Mid: "#ff5fc1", Dragon: "#ff6b6b" };

export const ITEM_ICONS = { Support: IconHeart, Defense: Shield, Boots: IconBoot, Enchant: IconWand, Magic: Flame, Physical: Swords };
export const ITEM_COLORS = { Support: "#ff5fc1", Defense: "#1fd0ff", Boots: "#f3c969", Enchant: "#9b6bff", Magic: "#3df0d8", Physical: "#ff6b6b" };
export const ITEM_CATEGORIES = ["Support", "Defense", "Boots", "Enchant", "Magic", "Physical"];

export const RUNE_ICONS = { Keystone: IconGem, Precision: Target, Domination: IconSkull, Resolve: Shield, Inspiration: Lightbulb };
export const RUNE_COLORS = { Keystone: "#f3c969", Precision: "#1fd0ff", Domination: "#ff6b6b", Resolve: "#9b6bff", Inspiration: "#ff5fc1" };
export const RUNE_PATHS = ["Keystone", "Precision", "Domination", "Resolve", "Inspiration"];

// Standard Wild Rift summoner spells — used to auto-render spell icons inside
// build notes whenever a Summoner Spells row mentions them (e.g. "Flash + Ignite").
// Image lookup key is "s:{id}" -> /assets/spells/{id}.{ext}
export const SUMMONER_SPELLS = [
  "flash", "ignite", "heal", "exhaust", "barrier", "ghost", "cleanse", "smite", "teleport", "mark",
];

// NOTE: "/admin" is deliberately NOT listed here -- it's a private area,
// reached only by navigating there directly, not a public nav item. See
// src/pages/AdminPage.jsx and README's "Safe Browsing cleanup" section.
export const NAV_LINKS = [
  { label: "Home", path: "/", page: "home" },
  { label: "AI Coach", path: "/ai-coach", page: "ai-coach" },
  { label: "Champions", path: "/tierlist", page: "tierlist" },
  { label: "Items", path: "/items", page: "items" },
  { label: "Runes", path: "/runes", page: "runes" },
  { label: "Guides", path: "/guides", page: "guides" },
  { label: "Patch Intel", path: "/patch-intelligence", page: "patch-intelligence" },
  { label: "Coaching", path: "/coaching", page: "coaching" },
];
