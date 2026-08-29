// Base/default Champion Matchup relationships -- structured,
// canonical-Champion-ID-only edges, keyed by championId the same way
// functions/_lib/kv.js's overrides.champions is keyed.
//
// Schema (Phase 3 -- Champion Matchups redesign, extended entry model):
//   { championId: string, difficulty: "low"|"medium"|"high", reason: string|null }
// One object per relationship, not a bare id string -- see
// src/components/ChampionMatchups.jsx and functions/api/coach-overrides.js
// for where this shape is displayed, edited, and validated.
//
// This is the ONLY Champion Matchup data source now (Phase 3 removed
// src/data/champions.js's legacy free-text `matchups` field entirely --
// it used to coexist alongside this file; it no longer exists anywhere
// in the codebase). Nothing here was re-migrated a second time from that
// removed field -- these entries are exactly Phase 2's original
// migration, RE-RUN once against the Phase 3-expanded 141-champion
// roster (src/data/champions.js) before the legacy field was deleted,
// so entries that named a real Wild Rift champion who simply wasn't in
// the roster yet (Jinx, Vayne, Lucian, Draven, Miss Fortune, Samira,
// Kai'Sa, Kog'Maw, Varus, Jhin, Ezreal, Camille, Orianna, Amumu, Brand,
// Syndra -- all of Phase 2's "out of scope" list) now resolve too. Nothing
// about the matching LOGIC changed, only the roster it was checked
// against -- same findCanonicalId() (src/utils/images.js), same
// exclusion of prose entries that mixed a category description with a
// couple of illustrative names (e.g. "disengagers like Janna or Karma";
// 8 such entries, unchanged from Phase 2), same exclusion of "Catchers"
// (Academy's own role-CATEGORY name, never a specific champion).
//
// difficulty: every migrated entry defaults to "medium" -- the original
// prose never had a low/medium/high severity scale, and guessing a
// specific severity per matchup would be inventing competitive judgment
// this file has no basis for. Re-rate these from Coach Mode as you
// review them.
// reason: carried forward VERBATIM from the original prose entry's own
// `note` field (Academy's own writing, not generated) where one
// existed; null where it didn't, editable from Coach Mode rather than
// invented here. A few entries share one `reason` across multiple
// champions because the original prose note applied to a named GROUP
// ("Strong With: Jinx, Vayne, Kog'Maw" -> one note, three entries) --
// each one is that same original context, not duplicated content.
//
// goodAgainst has no seed data anywhere: no existing prose was ever
// framed as "this matchup favors me", so there was nothing to migrate --
// entirely new coaching judgment for Coach Mode to add going forward.
//
// Directional, not reciprocal (redesign spec §9): leona.hardAgainst
// including senna does NOT imply senna.goodAgainst includes leona --
// each champion's entries were migrated independently from that
// champion's OWN prose, and Coach Mode edits never auto-write the
// reverse side either.
export const MATCHUPS = {
  alistar: {
    hardAgainst: [
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; thresh can also interruput your W/Q engage if he uses his E on time. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "thresh", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; thresh can also interruput your W/Q engage if he uses his E on time. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; thresh can also interruput your W/Q engage if he uses his E on time. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  blitzcrank: {
    hardAgainst: [
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  braum: {
    hardAgainst: [
      { championId: "karma", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "ezreal", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  galio: {
    hardAgainst: [],
    goodAgainst: [],
    goodWith: [
      { championId: "camille", difficulty: "medium", reason: null },
      { championId: "amumu", difficulty: "medium", reason: null },
      { championId: "jarvan-iv", difficulty: "medium", reason: null },
    ],
  },
  janna: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jhin", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "draven", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  leona: {
    hardAgainst: [
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  lulu: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
      { championId: "bard", difficulty: "medium", reason: "His Q can stun you or your ADC at any moment, and his ultimate can freeze your entire team at the worst possible time. Prioritize vision so you see him before he lands either of these." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jinx", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "kogmaw", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  maokai: {
    hardAgainst: [
      { championId: "karma", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  milio: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jinx", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "kogmaw", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  nami: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "lucian", difficulty: "medium", reason: "nami's W speeds them and heal them up, your E gives them more damage and slow down your enemies, your R is one of the greatest engaging ability. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "nami's W speeds them and heal them up, your E gives them more damage and slow down your enemies, your R is one of the greatest engaging ability. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "varus", difficulty: "medium", reason: "nami's W speeds them and heal them up, your E gives them more damage and slow down your enemies, your R is one of the greatest engaging ability. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  nautilus: {
    hardAgainst: [
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  pyke: {
    hardAgainst: [
      { championId: "nautilus", difficulty: "medium", reason: "nautilus and thresh can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls.also thresh can cancel your Q and E when you are casting it, with his E." },
      { championId: "thresh", difficulty: "medium", reason: "nautilus and thresh can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls.also thresh can cancel your Q and E when you are casting it, with his E." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "lucian", difficulty: "medium", reason: "these ADCs can follow up with pyke's cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "ezreal", difficulty: "medium", reason: "these ADCs can follow up with pyke's cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "varus", difficulty: "medium", reason: "these ADCs can follow up with pyke's cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
    ],
  },
  rakan: {
    hardAgainst: [
      { championId: "nautilus", difficulty: "medium", reason: "Rakan can be catched easily especially with nautilus's ult." },
      { championId: "thresh", difficulty: "medium", reason: "Rakan can be catched easily especially with nautilus's ult." },
      { championId: "janna", difficulty: "medium", reason: "Rakan can be catched easily especially with nautilus's ult." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "lucian", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "ezreal", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "varus", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
    ],
  },
  rell: {
    hardAgainst: [
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "karma", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  senna: {
    hardAgainst: [
      { championId: "nautilus", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "thresh", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "rakan", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "lucian", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "ezreal", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "varus", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
    ],
  },
  seraphine: {
    hardAgainst: [
      { championId: "nautilus", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "thresh", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "rakan", difficulty: "medium", reason: "Rakan can catch you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "camille", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "ezreal", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
      { championId: "orianna", difficulty: "medium", reason: "these ADCs can follow up with your W cc and take down enemies or play for a roaming style after they cleared the wave quickly." },
    ],
  },
  sona: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jinx", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "kogmaw", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  soraka: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jinx", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "kogmaw", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
  swain: {
    hardAgainst: [
      { championId: "nautilus", difficulty: "medium", reason: "these champions can catch or kill you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "brand", difficulty: "medium", reason: "these champions can catch or kill you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
      { championId: "syndra", difficulty: "medium", reason: "these champions can catch or kill you easily especially nautilus with his ult and take you down with their follow up CrowdControls." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "amumu", difficulty: "medium", reason: "these champions can follow up with your cc and take down enemies or play for one shot combo on enemies." },
      { championId: "ezreal", difficulty: "medium", reason: "these champions can follow up with your cc and take down enemies or play for one shot combo on enemies." },
      { championId: "varus", difficulty: "medium", reason: "these champions can follow up with your cc and take down enemies or play for one shot combo on enemies." },
      { championId: "orianna", difficulty: "medium", reason: "these champions can follow up with your cc and take down enemies or play for one shot combo on enemies." },
    ],
  },
  thresh: {
    hardAgainst: [
      { championId: "janna", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "zyra", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "morgana", difficulty: "medium", reason: "Ranged poke wears you down before you can engage. Janna's R tosses your whole engage aside; Morgana's shield absorbs your CC entirely; Zyra's plants punish you for walking forward. Against these, you need to engage after their cooldowns are burned, not into them." },
      { championId: "sett", difficulty: "medium", reason: "His W can absorb a huge amount of your engage damage and send it back. You can out-CC him, but if he catches you alone or grabs a carry, the table turns quickly." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "samira", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "draven", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "lucian", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
      { championId: "miss-fortune", difficulty: "medium", reason: "These ADCs want to kill fast after you land a hook. Samira especially — your chain CC feeds directly into her passive stack. The pattern is: hook, her follow-up, your ult if needed, and the kill is almost guaranteed. Miss Fortune's ult into your knocked-up hook is a teamfight finisher on its own." },
    ],
  },
  yuumi: {
    hardAgainst: [
      { championId: "senna", difficulty: "medium", reason: "A skilled Senna outranges and outpokes you at every stage of the game. She wins the slow, passive lane every time. Play safe, stay behind minions, and don't look for fights she hasn't started." },
    ],
    goodAgainst: [],
    goodWith: [
      { championId: "jinx", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "vayne", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
      { championId: "kogmaw", difficulty: "medium", reason: "Lulu is built for attack speed ADCs. Your W speeds them up, your E shields them, your R keeps them alive when they get dove. Ardent Censer amplifies all of this. These pairings turn a good ADC into a late-game threat that's nearly impossible to fight." },
    ],
  },
};
