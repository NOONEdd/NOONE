// Champion data — coaching notes, tiers, and Items/Runes/Matchups content
// written by Nyx NOONEdd. Add or edit entries here to update the site.

export const CHAMPIONS = [
  // Enchanter
  { id: "lulu", name: "Lulu", role: "Enchanter", tier: "S", blurb: "Top-tier enchanter for peel and saves, especially for ADCs who need attack speed. Her W can buff an ally or polymorph an enemy — the decision between those two uses is what separates good Lulu players from great ones.",
    builds: [
  {
    name: "Standard Enchanter",
    items: [

      { tag: "Always", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: "Your E only shields one ally at a time; Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields, more W uses, more E rotations per fight." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target. Works every time your E or Q hits." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
    ],
  },],
  },
  { id: "janna", name: "Janna", role: "Enchanter", tier: "B", blurb: "One of the best disengage supports — strong with AD carries who want the buff, solid healing and shielding.",
    items: [
      { tag: " relic shield", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
    ],
  },
  { id: "soraka", name: "Soraka", role: "Enchanter", tier: "B", blurb: "The best pure healer in the game — pick her when keeping the team alive matters most.",
    items: [
      { tag: "Always", name: "spectral sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Situational", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more heals." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
    ],},
  { id: "milio", name: "Milio", role: "Enchanter", tier: "S", blurb: "Strong pick against heavy-CC enemies, great for carries who need range, with light disengage via Q.",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
    ],},
  { id: "seraphine", name: "Seraphine", role: "Enchanter", tier: "B", blurb: "Good poke damage; a teamfight powerhouse thanks to her ult and combo damage, moderate as a pure enchanter.",
        builds: [
    {
    name: "enchanter support",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Oceanid's Trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },

    ],},
    {
      name: "high poke damage",
      items: [
          { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "luden's echo", note: "When you want to poke and burst enemies down. The passive gives you extra damage on your Q and E, letting you harass and kill squishy targets." },
      { tag: "core", name: "horizon focus", note: "When you want to poke and burst enemies down. The passive gives reveals enemies hit by your long-range abilities with extra damage, letting you follow up with your team." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "infinity orb", note: "When you want to maximize your damage output. The passive gives you extra attack speed and critical strike chance, letting you deal more damage in a shorter time." },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "first strike", note: "to deal more damage and gain gold. The passive gives you extra damage and gold when you hit an enemy champion first." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage when you pair enemies with your CC. The passive gives you extra damage when you hit an enemy champion that is impaired by your CC." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "summoner spells", name: "flash + ignite", note: "use your ignite on the enemy who has healing effect."},
      { tag: "summoner spells", name: "barrier ( swap for ignite)", note: " to have more sustainibility and prevent being one shotted."},
    ],}],},
 
    { id: "karma", name: "Karma", role: "Enchanter", tier: "A", blurb: "High mobility for catching or escaping, strong poke damage, moderate CC.",
    builds: [
  {
    name: "Standard Enchanter",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Oceanid's Trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
    ],},
  {
    name: "Full Damage Poke",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: "When you want to poke and burst enemies down. The passive gives you extra damage on your Q, letting you harass and kill squishy targets." },
      { tag: "core", name: "cryptobloom", note: "When you want to poke and burst enemies down and to give your allies more sustainbility by healing them each time you take down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "first strike", note: "to deal more damage and gain gold. The passive gives you extra damage and gold when you hit an enemy champion first." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage when you pair enemies with your CC. The passive gives you extra damage when you hit an enemy champion that is impaired by your CC." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "yuumi", name: "Yuumi", role: "Enchanter", tier: "A", blurb: "Enchanter built around one carry — boosts their movement speed, damage, healing, and shielding.",
      builds: [
  {
    name: "Standard Enchanter",
    items: [
   { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Cryptobloom", note: "to heal up your ally after you hit your Q or your ultiamte within 3 seconds and you took them down." },
      { tag: "Situational", name: "Malignance", note: "to reduce enemies magic resist and dealing more damage after you hit them with your ultimate." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields and heals." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "inspiration", name: "manaflow band", note: "to increase your mana espcially in early game." },
      { tag: "inspiration", name: "transcendence", note: "to gain more ability haste for lower cooldowns specifially in late game.." },
      { tag: "inspiration", name: "scorch", note: "to deal a bit damage with your Q or your Ultimate when you hit an enemy.." },
      { tag: "resolve", name: "revitalize", note: "amplifies the strenght of your shielding and healing.." },
      { tag: "Summoner Spells", name: "ignite + Heal", note: "Default setup. ignite to take down enemies faster and Heal as an emergency lifeline in lane fights." },
      { tag: "Spell Swap", name: "exhaust (swap for Heal)", note: "to reduce one of the main carry of enemies damage and slow them down." },
    ],
    
   }
 ],},
     
      { id: "sona", name: "Sona", role: "Enchanter", tier: "B", blurb: "Strong mid-to-late game buff support, moderate CC.",
         builds: [
  {
    name: "Standard Enchanter",
    items: [

      { tag: "Always", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more shields and heals." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
    ],
    
   }
 ],},

  // Catcher
  { id: "thresh", name: "Thresh", role: "Catcher", tier: "S", blurb: "Very strong late game into AD champions, with heavy CC and a bit of damage.",
      builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: " abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: "Take these when the enemy has multiple AD damage dealers or a strong auto-attack-reliant ADC." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you dive into the enemy team to hook, this shield keeps you alive long enough for your team to follow up." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for Nautilus — every hook, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since thresh produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    }
 ],
  },
  { id: "blitzcrank", name: "Blitzcrank", role: "Catcher", tier: "B", blurb: "Elite catcher if you land hooks — high mobility for chasing, high CC.",
      builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: " abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: "Take these when the enemy has multiple AD damage dealers or a strong auto-attack-reliant ADC." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you dive into the enemy team to hook, this shield keeps you alive long enough for your team to follow up." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since blitzcrank produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
  }
],
  },
  { id: "leona", name: "Leona", role: "Catcher", tier: "A", blurb: "High sustain and CC; one of the best engage supports, with moderate damage depending on build.",
      builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: " abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: "Take these when the enemy has multiple AD damage dealers or a strong auto-attack-reliant ADC." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you dive into the enemy team to engage, this shield keeps you alive long enough for your team to follow up." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since leona produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
  }],
  },
  { id: "pyke", name: "Pyke", role: "Assassin Catcher", tier: "A", blurb: "Hard to catch with high mobility; strong damage and execute potential on squishies, one of the best roamer-gankers.",
     builds: [
  {
    name: "Standard Assassin Catcher",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "your mission item for almot every match.otherwise if you need more HandPlatter, you can bring Relic Shieled." },
      { tag: "core", name: "Youmuu's Ghostblade", note: "for the ganker and roaming style only because of the movement speend that it gives and the higher attack speed to takedown your enemies quickly." },
      { tag: "core", name: "Duskblade of Draktharr", note: " to slow down enemies when you catch them." },
      { tag: "core", name: "edge of night", note: " for not being catched easily." },
      { tag: "situational", name: "serpent's fang", note: " only when enemies have too much of shielding effect.buy this item to reduce their shield effecr." },
      { tag: "situational", name: "mortal reminder", note: " to reduce enemies healing effect.although for their healing effect you should bring its tier 2 item, which is executioner's call." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: " boots", name: "boots of dynamism", note: " to deal more damage on your enemies." },
    ],
  runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since pyke produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
  ],}], },
  { id: "rakan", name: "Rakan", role: "Catcher", tier: "S", blurb: "Quick high-damage engages on squishies, with strong mobility and some save potential via Q and E.",
        builds: [
  {
   name: "Standard tank Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: " abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "boots of lucidity", note: " to reduce your cooldown and give you mana regen since you need mana too much in early and mid game." },
      { tag: "Enchant", name: "protobelt", note: "Default enchant — when you dive into the enemy team to engage, this shield keeps you alive long enough for your team to follow up." },
    ],
    runes: [
         { tag: "Keystone", name: "Ice Overlord", note: "Built for Rakan — every engage, every CC procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since Rakan produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },

    ],},

    {
      name: "High AP Damage Engager",
      items: [
         { tag: "Always", name: "Spectral Sickle", note: "your mission item for almot every match since you are going full damage build." },
      { tag: "core", name: "Lich Bane", note: "for dealing more damage after each ability that you cast and use." },
      { tag: "core", name: "Cryptobloom", note: " to deal more damage and have a utility for each kill or take down. so you can heal up your allies." },
      { tag: "core", name: "Malignance", note: " to shred enemies magic resist and kill them faster." },
      { tag: "situational", name: "Banshee's Veil", note: " only when enemies have too much cc abilities or to block one essential ability of enemies." },
      { tag: "situational", name: "Oceanid's Trident", note: " only when enemies have too much of shielding effect.buy this item to reduce their shield effecr." },
      { tag: "situational", name: "Morellonomicon", note: " only when enemies have too much of healing effect so you want to reduce their healing effect." },
      { tag: "situational", name: "void staff", note: " to deal more damage on enemies who has significant amount of magic resist." },
      { tag: " boots", name: "boots of lucidity", note: " to lower your cooldown of abilities." },
      { tag: " Enchant", name: "Protobelt", note: " to be able engage much more better especially with you W." },
    ],
  runes: [
      { tag: "Keystone", name: "electrocute", note: "for dealing more damage after casting 3 consecutive abilites on enemy or 3 basic attacks." },
      { tag: "Domination", name: "Sudden Impact", note: "to deal more damage for each engage and dashes that you have like W." },
      { tag: "Domination", name: "Chain Assault", note: "dealing moree damage after using consecutive abilities on enemy." },
      { tag: "Domination", name: "Zombie Ward", note: "Makes you permanently to have more AP damage after killing or dewarding an enemy ward.really essential for late game." },
      { tag: "Inspiration", name: "Transcendence", note: "gives you more ability haste so that you can use your abilities more often in mid-late game." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Transcendence)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Ingenious Hunter (swap for Zombie Ward)", note: "to increase your ability haste and lower your cooldown when you think your damage is enough." },
  ],}], },
    
      // Warden
  { id: "braum", name: "Braum", role: "Warden", tier: "S", blurb: "Best-in-class disengage and damage-blocking, with high CC for catching enemies too.",
       builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: "Take these when the enemy has multiple AD damage dealers or a strong auto-attack-reliant ADC." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you dive into enemies or they catch you in fight and you want to survive a bit more with the given shield by this enchant." },
    ],
    runes: [
      { tag: "Keystone", name: "Gaurdian", note: "Built for Braum — every time your ADC or any ally takes damage with you,both of you gain shield and Hp ." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since Braum produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage or saving allies is cruical." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],}],
  },
  { id: "nautilus", name: "Nautilus", role: "Catcher", tier: "S", blurb: "Excessive CC, strong engage for catching enemies — best paired with ADCs who can follow up fast. One of the highest CC outputs of any support in the game.",
      builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "Situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: " abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: "Take these when the enemy has multiple AD damage dealers or a strong auto-attack-reliant ADC." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you want to get to the enemies faster and dive into the enemy team to engage." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for Nautilus — every hook, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since Nautilus produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your hook combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],}],
  },
  { id: "alistar", name: "Alistar", role: "Catcher", tier: "A", blurb: "Best-in-class tank for sustain and damage soak; elite playmaker for throwing enemies into your team to kill.",
            builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: "abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: " to reduce your cooldown and give you mana regen since you need mana too much in early and mid game." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "protobelt", note: "Default enchant — when you wanna get to the enemies faster and dive into the enemy team to engage." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for alistar — every engage, every CC procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since alistar produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],}],
  },

  { id: "rell", name: "Rell", role: "Catcher", tier: "S", blurb: "Top-tier tank and engager with high CC — especially strong alongside one-shot AP carries like Orianna, Syndra, or Kennen.",
          builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: "abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "boots of lucidity", note: " to reduce your cooldown and give you mana regen since you need mana too much in early and mid game." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you want to get to the enemies faster and dive into the enemy team to engage." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for maokai — every engage, every CC procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since rell produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],}],
  },
  { id: "maokai", name: "Maokai", role: "Catcher", tier: "A", blurb: "Excellent at catching enemies — one of the best engage ultimates in the game.",
          builds: [
  {
    name: "Standard Catcher",
    items: [
      { tag: "Always", name: "Relic Shield", note: "Your mission item every game. HP and gold generation are both valuable on a tank support." },
      { tag: "Core", name: "Zeke's Convergence", note: "Makes your engage directly lethal — the aura slows enemies and adds damage near you after your ultimate. Your hook into Zeke's into ally follow-up is a reliable kill pattern." },
      { tag: "Core", name: "Warmog's Armor", note: "When you want to roam and gank other lanes. The health regen means you can rotate without caring about HP, then re-enter a fight immediately. Only buy this if your ADC can handle themselves — not with Vayne, Ashe, or Jinx." },
      { tag: "Situational", name: "Frozen Heart", note: "Against high attack speed champions (Jinx, Kog'Maw, Tryndamere). The aura cuts their attack speed significantly and reduces their sustained DPS." },
      { tag: "Situational", name: "Force of Nature", note: "When the enemy team has too much AP damage. Lets you survive longer in teamfights and keeps you relevant through the whole fight rather than getting burst down early." },
      { tag: "Situational", name: "Iceborn Gauntlet", note: "When you're confident you can catch enemies and want your engage to deal more damage. The slow on your attacks makes your hook combos even harder to escape." },
      { tag: "Situational", name: "Randuin's Omen", note: "Against crit-heavy carries (Miss Fortune, Jinx, Xayah). Reduces the damage you take from critical strikes — makes their entire damage pattern weaker against you." },
      { tag: "Situational", name: "Thornmail", note: "Against healing-heavy enemies (Soraka, lifesteal ADCs, Swain). The Grievous Wounds on contact halves their healing for 3 seconds." },
      { tag: "situational", name: "Yordle Trap", note: "After you displace an enemy with your hook or ult, their armor and magic resist drop and you earn bonus gold on their death. Punishes every successful engage." },
      { tag: "situational", name: "abyssal mask", note: " buy this item to get magic resist and when you have too much AP damage in your team and enemies are buying too much magic resist. so your allies will be able to deal more damage." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: "Boots vs AD", name: "Plated Steelcaps", note: " to reduce your cooldown and give you mana regen since you need mana too much in early and mid game." },
      { tag: "Boots vs AP", name: "Mercury's Treads", note: "Take these when the enemy has multiple AP damage sources or heavy CC that interrupts your engages." },
      { tag: "Enchant", name: "Stoneplate Enchant", note: "Default enchant — when you want to get to the enemies and dive into the enemy team to engage." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for maokai — every engage, every CC procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since maokai produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],}],
  },

  // Mage Support
  { id: "zyra", name: "Zyra", role: "Mage Support", tier: "A", blurb: "Great answer to hook-heavy catchers; deals strong damage into tanks — pick her when the enemy has 3+ tanks.",
      builds: [
        {
    name: "Full Damage Poke",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: "When you want to poke and burst enemies down. The passive gives you extra damage on your Q, letting you harass and kill squishy targets." },
      { tag: "core", name: "cryptobloom", note: "When you want to poke and burst enemies down and to give your allies more sustainbility by healing them each time you take down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "situational", name: "Rylai's Crystal Scepter", note: " Damaging abilities slow the target — turns any mage's poke into extra kiting power, especially strong on AOE/DOT-heavy kits." },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down the enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage when you pair enemies with your CC. The passive gives you extra damage when you hit an enemy champion that is impaired by your CC." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "nami", name: "Nami", role: "Mage Support", tier: "S", blurb: "High CC; trades movement speed to allies for slowing enemies — a top pick for healing plus CC.",
        builds: [
  {
    name: "Standard Enchanter",
    items: [

      { tag: "Always", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      { tag: "Core", name: "Ardent Censer", note: "When your ADC needs attack speed (Jinx, Vayne, Kog'Maw). The earlier you finish this, the sooner they spike in power. A core pick most games." },
      { tag: "Core", name: "Staff of Flowing Water", note: "When your allies need ability haste — lets them use their abilities more often in fights. Strong with champions who have high-value cooldowns." },
      { tag: "Core", name: "Harmonic Echo", note: " Harmonic Echo's passive lets you heal multiple teammates. Buy this when you need to support the whole team, not just your ADC." },
      { tag: "Situational", name: "Banshee's Veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "Situational", name: "Amaranth's Twinguard", note: "When the enemy has too much CC. Gives armor, magic resist, and tenacity — pair with Perseverance rune for maximum CC resistance in that game." },
      { tag: "Situational", name: "Frozen Heart", note: "When the enemy ADC or fighters have too much attack speed. The aura slows their attack speed significantly, cutting their sustained damage output." },
      { tag: "Situational", name: "Archangel's Staff", note: "When you need lots of mana to use your abilities especially in early-mid game.you can buy tear of goddess to increase your mana first and after having it fully stacked, try to buy Archangel's Staff." },
      { tag: "Boots", name: "Ionian Boots of Lucidity", note: "Default boots — lower cooldowns mean more heals." },
      { tag: "Enchant", name: "Mikael's Blessing", note: "Default enchant. Cast on an ally to protect them from a single crucial enemy ability — this cannot be used on yourself, so always have a priority target in mind before you need it." },
      { tag: "Enchant", name: "Locket (instead of Mikael's Blessing or Redemption)", note: "Buy this if there are 2-3 carry champions on your team and you need to shield everyone simultaneously in a teamfight, not just one person." },
    ],
    runes: [
      { tag: "Keystone", name: "Summon Aery", note: "Default — procs on every shield you cast and every poke ability. Constant pressure in lane and constant protection in fights." },
      { tag: "Resolve", name: "Font of Life", note: "Free team sustain — marks enemies you slow or CC, then your allies heal when they attack the marked target." },
      { tag: "Resolve", name: "Bone Plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "Resolve", name: "Revitalize", note: "Amplifies all your heals and shields. This is your default — swap to Perseverance if the enemy has too much CC." },
      { tag: "Inspiration", name: "Transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "Summoner Spells", name: "Flash + Heal", note: "Default setup. Flash to reposition or save yourself; Heal as an emergency lifeline in lane fights." },
      { tag: "Rune Swap", name: "Perseverance (swap for Revitalize)", note: "When the enemy has too much CC — pair with Amaranth's Twinguard. Gives tenacity so you're not chain-controlled every fight." },
      { tag: "Spell Swap", name: "Ignite (swap for Heal)", note: "Against enemy healers in lane (Soraka, Nami, Yuumi). Ignite's Grievous Wounds cuts their healing in half while you fight." },
    ],
    
   }
 ],},

  { id: "bard", name: "Bard", role: "Mage Support", tier: "B", blurb: "One of the best playmaking and catching champions — his ultimate can swing a whole fight.",
   builds: [
    {
    name: "Full Damage Roamer",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "lich bane", note: " to deal more damage after using an ability." },
      { tag: "core", name: "stormsurge", note: "to deal more damage against tanky and high HP champions." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "electrocute", note: "to deal more damage after 3 consecutive abilities or basic attacks." },
      { tag: "domination", name: "empowered attack", note: " to deal extra damage each 8 seconds." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "zilean", name: "Zilean", role: "Mage Support", tier: "A", blurb: "Strong poke and ability-blocking; light on buffs besides movement speed, but his ult — an ally revive — is one of the best in the game.",
      builds: [
    {
    name: "Full Damage poker",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: " to deal more damage after using an ability." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down your enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage after slowing down or stun your enemies ." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  // Off-Meta Flex
  { id: "mel", name: "Mel", role: "Off-Meta Flex", tier: "A", blurb: "Very strong early game; can block and reflect enemy abilities back at them, with high damage.",
      builds: [
    {
    name: "Full Damage poker",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: " to deal more damage after using an ability." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down your enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage after slowing down or stun your enemies ." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "taliyah", name: "Taliyah", role: "Off-Meta Flex", tier: "A", blurb: "One of the best playmaker and catcher supports, though her kit takes practice — high damage into squishies.",
      builds: [
    {
    name: "Full Damage Roamer",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: " to deal more damage after using an ability." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down your enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage after slowing down or stun your enemies ." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "sett", name: "Sett", role: "Off-Meta Flex", tier: "B", blurb: "Strong tank and engager — ult their frontline to start fights. High damage if fed, since W can one-shot off HP, with moderate CC.",
     builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "heartsteel", note: " to deal more damage and most importantly gain more HP to deal more true damage with your W." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "Overlord's Bloodmail", note: " to deal more damage based of your MAX HP and gain more attack damage when you miss your health." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since sett produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "norra", name: "Norra", role: "Off-Meta Flex", tier: "B", blurb: "Strong poke; W can pull the enemy frontline or tank out of the fight so you can pick off the rest.",
      builds: [
    {
    name: "Full Damage poker",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: " to deal more damage after using an ability." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down your enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage after slowing down or stun your enemies ." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "senna", name: "Senna", role: "Off-Meta Flex", tier: "S", blurb: "Scales hard into late game if you secure stacks; solid damage and some CC, great in teamfight comps.",
       builds: [
    {
    name: "Full Damage one shot late game",
    items: [
      {tag: "core", name: "Duskblade of Draktharr", note: " to slow down enemies and deal more damage to them." },
      {tag: "core", name: "mortal reminder", note: " to deal more damage espically against tanks and to apply anti heal effect on healers and those who are getting healing buff." },
      {tag: "core", name: "edge of night", note: " to prevnt being catched easily and block one of enemies cc oor crucial ability." },
      {tag: "core", name: "serpent's fang", note: "essential against shield effects. you can reduce their shielding buff and take down your enemies quickly." },
      {tag: "situational", name: "eclipse", note: "buy this item only against tanks and high HP champions and you can gain a shield effect on yourself after damaging an enemy." },
      {tag: "situational", name: "divine sunderer", note: " to heal up after each attack that you deal and most importantly like eclipse, to deal more damage against high HP chapions." },
      {tag: "sitatuinal", name: "the collector", note: " to deal extra damage and take down enemies quickly and to gain a bit of gold." },
      {tag: "boots", name: " boots of dynamism", note: " to deal more damage." },
    ],
    runes:  [
      {tag: " keystone", name: "fleet footwork", note: " to heal up a bit and gain movement speed after you deal a damage to an enemy if it was fully stacked." },
      {tag: "domination", name: "Empowered Attack", note: " to deal extra damage each 8 seconds." },
      {tag: "domination", name: "Chain Assault", note: " to deal extra damage after using abilities on enemy." },
      {tag: "domination", name: "Zombie Ward", note: " one of the greatest runes for late games. especially for senna who needs her stacks ." },
      {tag: "resolve", name: "Bone Plating", note: " to prevent from being one shotted of burst damages and combos." },
      {tag: "Summoner Spells", name: " flash + ignite", note: " use your ignite on the enemy who has healing effect to take them down quickly." },

    ],},
    {
      name: "supporting style with high damage",
      items: [
         { tag: "Always", name: "Spectral Sickle", note: "your mission item for almot every match.otherwise if you need more HandPlatter, you can bring Relic Shieled." },
      { tag: "core", name: "Youmuu's Ghostblade", note: "for the ganker and roaming style only because of the movement speend that it gives and the higher attack speed to takedown your enemies quickly." },
      { tag: "core", name: "Duskblade of Draktharr", note: " to slow down enemies when you catch them." },
      { tag: "core", name: "edge of night", note: " for not being catched easily." },
      { tag: "situational", name: "serpent's fang", note: " only when enemies have too much of shielding effect.buy this item to reduce their shield effecr." },
      { tag: "situational", name: "mortal reminder", note: " to reduce enemies healing effect.although for their healing effect you should bring its tier 2 item, which is executioner's call." },
      { tag: "situatinal", name: "Amaranth's Twinguard", note: " buy this defensive item only when you think enemies have too much damage and also you need a bit of tenacity." },
      { tag: " boots", name: "boots of dynamism", note: " to deal more damage on your enemies." },
    ],
  runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Nullifying Orb", note: "When you take magic damage that would drop you below a health threshold, gain a magic shield that absorbs the excess — a rune-based safety net specifically into heavy AP burst.." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Precision", name: "Brutal", note: "Gives you a small amount of damage to trade with your enemies and win them." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
  ],}], },
    
  { id: "swain", name: "Swain", role: "Off-Meta Flex", tier: "C", blurb: "Good sustain tank for long teamfights, with moderate damage on a tank build.",
      builds: [
    {
    name: "Full Damage one shot",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "malignance", note: " to deal more damage after using your ultimate and to shred and reduce enemies magic resist." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
      { tag: "enchant", name: "Stasis Enchant", note: " to stay alive a bit more seconds while your enemies are fighting with your enemy or to prevent from a oneshot combo or to seek help from your allies to arrive." },
    
    ],
    runes: [
      { tag: "keystone", name: "ice overlord", note: "to deal more damage and slow down your enemies." },
      { tag: "inspiration", name: "Axiom Arcanist", note: " Your ultimate ability deals more damage and grants more healing/shielding, and getting a takedown shaves extra time off its cooldown — built for ultimate-centric playstyles. ." },
      { tag: "inspiration", name: "Transcendence", note: " Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: "inspiration", name: "Nimbus Cloak", note: "Casting a summoner spell grants a burst of bonus move speed that decays over a few seconds — great with Flash or Ignite for engaging or repositioning right after casting.." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],},
{
      name: "tank support",
  items: [ 
    {tag: "always", name: "Relic Shield", note: "Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
    {tag: "core", name: "Malignance", note: "to deal more damage after using your ultimate and to shred and reduce enemies magic resist." },
    {tag: "core", name: " Rylai's Crystal Scepter", note: "Damaging abilities slow the target — turns any mage's poke into extra kiting power, especially strong on AOE/DOT-heavy kits." },
    {tag: "core", name: "cryptobloom", note: "to deal more damage and heal up your allies after taking down an enemy." },
    {tag: "situational", name: "randuin's omen", note: " against high critical damage dealers like lucian or draven or any other champions who deals AD critical damage." },
    {tag: "situational", name: "hollow radiance", note: " to deal more damage and also burst enemies to take them down quickly." },
    {tag: "situatuinal", name: "frozen heart", note: " against high attack speed champions to slow their basic attacks." },
    {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist and deal more AP damage to them." },
    {tag: "situational", name: "Amaranth's Twinguard", note: " to gain more sustainbility and tenacity in team fights." },
    {tag: "boots VS AP", name: "Mercury's Treads", note: " to be more tanky against AP damage dealers and gain a bit of tencaity." },
    {tag: "boots VS AD", name: "Plated Steelcaps", note: " to be more tanky against AD damage dealers." },
  ],
  runes: [
      {tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every engage, every CC procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since swain produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your engage combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
  ],}], },
    
  { id: "lux", name: "Lux", role: "Off-Meta Flex", tier: "B", blurb: "High poke damage into squishies — one of the best at one-shotting players.",
      builds: [
    {
    name: "Full Damage one shot",
    items: [
      { tag: "Always", name: "Spectral Sickle", note: "Your support mission item every game — gives AP and rotates gold to your ADC. Never skip this." },
      { tag: "core", name: "blackfire torch", note: " to deal more damage after using an ability." },
      { tag: "core", name: "cryptobloom", note: "to deal more damage to your enemies and heal them up after taking down an enemy." },
      { tag: "core", name: "rabadon's deathcap", note: "to deal more damage. The passive gives you extra AP, letting you burst squishy targets down faster." },
      { tag: "situational", name: "banshee's veil", note: "When the enemy can catch and one-shot you instantly. The passive gives you a brief survival window to react before you die." },
      { tag: "situational", name: "oceanid's trident", note: "when enemies have too much shield effect. The passive reduces their shield effectiveness, letting your team fight through their defensive abilities." },
      { tag: "situational", name: "Morellonomicon", note: "When the enemy has too much healing. The passive gives you Grievous Wounds, letting your team fight through their healing abilities." },
      { tag: "situational", name: "bloodletter's curse", note: "When you want to maximize your damage output. the passive shreds enemies magic resistance so you will be able to deal more damage" },
      { tag: "boots", name: "boots of mana", note: "to deal more damage. the upgraded boots gives you more mana regen and extra damaage." },
    ],
    runes: [
      { tag: "keystone", name: "arcane comet", note: "to deal more damage and slow down your enemies." },
      { tag: "domination", name: "cheap shot", note: " to deal extra damage after slowing down or stun your enemies ." },
      { tag: "domination", name: "chain assault", note: " to deal more damage when you hit your abilites." },
      { tag: "domination", name: "zombie ward", note: "gives vision and more AP. The passive gives you extra vision and AP when you kill an enemy ward." },
      { tag: "resolve", name: "bone plating", note: "Prevents you from being one-shotted by a single burst combo. Essential when the enemy has an assassin or burst-heavy carry who can reach you." },
      { tag: "inspiration( swap for bone plating)", name: " transcendence", note: "Ability haste at levels 1 and 6, plus cooldown refunds later. Keeps your W and E cycling faster throughout the entire game." },
      { tag: " summoner spells", name: "flash + ignite", note: "use your ignite on the enemy to apply grevious wounds effect to reduce their healing."}
    ],
  }
],},
  { id: "galio", name: "Galio", role: "Off-Meta Flex", tier: "S", blurb: "Excellent at both engaging and disengaging, with high CC — his ultimate is a huge fight-changer.",
     builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "frozen heart", note: " to reduce enemies attack speed." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since galio produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "jarvan-iv", name: "Jarvan IV", role: "Off-Meta Flex", tier: "B", blurb: "Devastating into champions with no dash or blink to escape his ult; great for catching and deleting a single target in teamfights, plus attack speed from E.",
      builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "frozen heart", note: " to reduce enemies attack speed." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since jarvan iv produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "gragas", name: "Gragas", role: "Off-Meta Flex", tier: "C", blurb: "Elite playmaker via ult or Flash-E combo; hits tanks hard.",
       builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "frozen heart", note: " to reduce enemies attack speed." },
      {tag: "core", name: "Iceborn Gauntlet", note: " to deal more damage after using your abilities and slow down your enemies." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since gragas produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "ornn", name: "Ornn", role: "Off-Meta Flex", tier: "A", blurb: "Strong engage and playmaking champion, good in teamfights, moderate damage into tanks.",
     builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "heartsteel", note: " to deal more damage and most importantly gain more HP." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since ornn produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "poppy", name: "Poppy", role: "Off-Meta Flex", tier: "C", blurb: "One of the best picks into blink or dash-heavy enemies; her ultimate is great for catching someone and throwing them out of the fight.",
     builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "heartsteel", note: " to deal more damage and most importantly gain more HP." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "Overlord's Bloodmail", note: " to deal more damage based of your MAX HP and gain more attack damage when you miss your health." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since poppy produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "morgana", name: "Morgana", role: "Off-Meta Flex", tier: "C", blurb: "A versatile support champion with strong crowd control and damage capabilities.",
     builds: [
    {
    name: "Full Damage Support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "heartsteel", note: " to deal more damage and most importantly gain more HP." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "core", name: "Overlord's Bloodmail", note: " to deal more damage based of your MAX HP and gain more attack damage when you miss your health." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since poppy produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  { id: "skarner", name: "Skarner", role: "Catcher", tier: "Unranked", blurb: "His charge (grabbing and dragging a champion into a wall) and ultimate (suppressing and dragging up to 3 enemies) are genuine catcher tools. Worth knowing: every current source describes him as primarily a jungler, not an established support — treat this as an experimental pick until there's real match data to back it, not a settled recommendation.",
    builds: [
    {
    name: "tanky support",
    items: [
      {tag: "always", name: "Relic Shield", note:"Your support mission item every game — gives HP and rotates gold to your ADC. Never skip this." },
      {tag: "core", name: "heartsteel", note: " to deal more damage and most importantly gain more HP." },
      {tag: "core", name: "warmog's armor", note: "to gain more HP for dealing more damage with your W and get HP regen out of combat and get back to fights quickly or to roam." },
      {tag: "situational", name: "randuin's omen", note: "to reduce the critical damage taken." },
      {tag: "situational", name: "force of nature", note: " to be more tanky in fights against AP damage dealers." },
      {tag: "situational", name: "abyssal mask", note: " to reduce enemies magic resist when you have too much AP damage dealer in your team." },
      {tag: "situational", name: "thornmail", note: "only against healers to reduce their healing effect when they attack you." },
      {tag: "situational", name: "unending despair", note: " to deal more damage based on your max health and also heal yourself up a bit." },
    ],
    runes: [
      { tag: "Keystone", name: "Ice Overlord", note: "Built for catchers — every cc, every ult, every passive stun procs the damage and slow. Your entire kit triggers this constantly. Non-negotiable." },
      { tag: "Resolve", name: "Courage of the Colossus", note: "Every time you immobilize an enemy (which is every engage), you get a shield. Since skarner produces CC almost constantly in a fight, this shield is nearly permanent." },
      { tag: "Resolve", name: "Second Wind", note: "Sustains you in lane against poke damage. Swap to Bone Plating when the enemy has a burst or one-shot combo instead." },
      { tag: "Resolve", name: "Overgrowth", note: "Makes you permanently tankier the longer the game goes on. Swap to Perseverance against tanks or heavy CC where tenacity matters more than raw HP." },
      { tag: "Inspiration", name: "Hextech Flashtraption", note: "Gives you a charged blink when Flash is on cooldown — lets you initiate even without Flash available, which is massive for a champion whose engage threatens the whole map." },
      { tag: "Summoner Spells", name: "Flash + Ignite", note: "Flash for the unexpected engage angle that catches the enemy off-guard; Ignite to secure kills after your combo lands." },
      { tag: "Rune Swap", name: "Bone Plating (swap for Second Wind)", note: "When the enemy has a one-shot combo or heavy burst in lane. Bone Plating reduces their damage window and keeps you alive through the first rotation of abilities." },
      { tag: "Rune Swap", name: "Perseverance (swap for Overgrowth)", note: "Against tanks or enemies with heavy CC. Tenacity reduces how long you get chain-controlled, letting you get your own CC off faster in return." },
    ],
    },],
  },
  // ---- Full Wild Rift roster expansion (Phase 3, Champion Matchups redesign) ----
  // Added so the Matchup picker can select ANY current Wild Rift champion, not just
  // the 36 Support-focused ones above. Minimal fields ONLY -- id/name/role/tier --
  // no builds/items/runes/blurb, since none of that coaching content exists for
  // these champions yet; inventing it would misrepresent Academy expertise that
  // hasn't actually been written. tier is "Unranked" for all of them (an already-
  // established, valid bucket -- see src/data/constants.js TIER_ORDER) rather than
  // a guessed ranking. role is a conventional primary-lane tag (Baron/Jungle/Mid/
  // Dragon -- Wild Rift's own lane names), used only for the same icon/accent-color
  // /filter-tag purpose the existing 36 champions' role already serves, not a
  // competitive or support-viability judgment. ids generated via this file's own
  // slugify() (src/utils/images.js) -- the project's own established convention,
  // confirmed by reproducing the existing jarvan-iv id exactly from 'Jarvan IV'.
  { id: "aatrox", name: "Aatrox", role: "Baron", tier: "Unranked" },
  { id: "ahri", name: "Ahri", role: "Mid", tier: "Unranked" },
  { id: "akali", name: "Akali", role: "Mid", tier: "Unranked" },
  { id: "akshan", name: "Akshan", role: "Mid", tier: "Unranked" },
  { id: "ambessa", name: "Ambessa", role: "Baron", tier: "Unranked" },
  { id: "amumu", name: "Amumu", role: "Jungle", tier: "Unranked" },
  { id: "annie", name: "Annie", role: "Mid", tier: "Unranked" },
  { id: "ashe", name: "Ashe", role: "Dragon", tier: "Unranked" },
  { id: "aurelion-sol", name: "Aurelion Sol", role: "Mid", tier: "Unranked" },
  { id: "aurora", name: "Aurora", role: "Mid", tier: "Unranked" },
  { id: "brand", name: "Brand", role: "Mid", tier: "Unranked" },
  { id: "caitlyn", name: "Caitlyn", role: "Dragon", tier: "Unranked" },
  { id: "camille", name: "Camille", role: "Baron", tier: "Unranked" },
  { id: "chogath", name: "Cho'Gath", role: "Baron", tier: "Unranked" },
  { id: "corki", name: "Corki", role: "Mid", tier: "Unranked" },
  { id: "darius", name: "Darius", role: "Baron", tier: "Unranked" },
  { id: "diana", name: "Diana", role: "Jungle", tier: "Unranked" },
  { id: "dr-mundo", name: "Dr. Mundo", role: "Baron", tier: "Unranked" },
  { id: "draven", name: "Draven", role: "Dragon", tier: "Unranked" },
  { id: "ekko", name: "Ekko", role: "Jungle", tier: "Unranked" },
  { id: "evelynn", name: "Evelynn", role: "Jungle", tier: "Unranked" },
  { id: "ezreal", name: "Ezreal", role: "Dragon", tier: "Unranked" },
  { id: "fiddlesticks", name: "Fiddlesticks", role: "Jungle", tier: "Unranked" },
  { id: "fiora", name: "Fiora", role: "Baron", tier: "Unranked" },
  { id: "fizz", name: "Fizz", role: "Mid", tier: "Unranked" },
  { id: "garen", name: "Garen", role: "Baron", tier: "Unranked" },
  { id: "gnar", name: "Gnar", role: "Baron", tier: "Unranked" },
  { id: "graves", name: "Graves", role: "Jungle", tier: "Unranked" },
  { id: "gwen", name: "Gwen", role: "Baron", tier: "Unranked" },
  { id: "hecarim", name: "Hecarim", role: "Jungle", tier: "Unranked" },
  { id: "heimerdinger", name: "Heimerdinger", role: "Mid", tier: "Unranked" },
  { id: "irelia", name: "Irelia", role: "Baron", tier: "Unranked" },
  { id: "jax", name: "Jax", role: "Baron", tier: "Unranked" },
  { id: "jayce", name: "Jayce", role: "Baron", tier: "Unranked" },
  { id: "jhin", name: "Jhin", role: "Dragon", tier: "Unranked" },
  { id: "jinx", name: "Jinx", role: "Dragon", tier: "Unranked" },
  { id: "ksante", name: "K'Sante", role: "Baron", tier: "Unranked" },
  { id: "kaisa", name: "Kai'Sa", role: "Dragon", tier: "Unranked" },
  { id: "kalista", name: "Kalista", role: "Dragon", tier: "Unranked" },
  { id: "kassadin", name: "Kassadin", role: "Mid", tier: "Unranked" },
  { id: "katarina", name: "Katarina", role: "Mid", tier: "Unranked" },
  { id: "kayle", name: "Kayle", role: "Baron", tier: "Unranked" },
  { id: "kayn", name: "Kayn", role: "Jungle", tier: "Unranked" },
  { id: "kennen", name: "Kennen", role: "Baron", tier: "Unranked" },
  { id: "khazix", name: "Kha'Zix", role: "Jungle", tier: "Unranked" },
  { id: "kindred", name: "Kindred", role: "Jungle", tier: "Unranked" },
  { id: "kogmaw", name: "Kog'Maw", role: "Dragon", tier: "Unranked" },
  { id: "lee-sin", name: "Lee Sin", role: "Jungle", tier: "Unranked" },
  { id: "lillia", name: "Lillia", role: "Jungle", tier: "Unranked" },
  { id: "lissandra", name: "Lissandra", role: "Mid", tier: "Unranked" },
  { id: "lucian", name: "Lucian", role: "Dragon", tier: "Unranked" },
  { id: "malphite", name: "Malphite", role: "Baron", tier: "Unranked" },
  { id: "master-yi", name: "Master Yi", role: "Jungle", tier: "Unranked" },
  { id: "miss-fortune", name: "Miss Fortune", role: "Dragon", tier: "Unranked" },
  { id: "mordekaiser", name: "Mordekaiser", role: "Baron", tier: "Unranked" },
  { id: "nasus", name: "Nasus", role: "Baron", tier: "Unranked" },
  { id: "nidalee", name: "Nidalee", role: "Jungle", tier: "Unranked" },
  { id: "nilah", name: "Nilah", role: "Dragon", tier: "Unranked" },
  { id: "nocturne", name: "Nocturne", role: "Jungle", tier: "Unranked" },
  { id: "nunu-willump", name: "Nunu & Willump", role: "Jungle", tier: "Unranked" },
  { id: "olaf", name: "Olaf", role: "Jungle", tier: "Unranked" },
  { id: "orianna", name: "Orianna", role: "Mid", tier: "Unranked" },
  { id: "pantheon", name: "Pantheon", role: "Jungle", tier: "Unranked" },
  { id: "rammus", name: "Rammus", role: "Jungle", tier: "Unranked" },
  { id: "renekton", name: "Renekton", role: "Baron", tier: "Unranked" },
  { id: "rengar", name: "Rengar", role: "Jungle", tier: "Unranked" },
  { id: "riven", name: "Riven", role: "Baron", tier: "Unranked" },
  { id: "rumble", name: "Rumble", role: "Baron", tier: "Unranked" },
  { id: "ryze", name: "Ryze", role: "Mid", tier: "Unranked" },
  { id: "samira", name: "Samira", role: "Dragon", tier: "Unranked" },
  { id: "shen", name: "Shen", role: "Baron", tier: "Unranked" },
  { id: "shyvana", name: "Shyvana", role: "Jungle", tier: "Unranked" },
  { id: "singed", name: "Singed", role: "Baron", tier: "Unranked" },
  { id: "sion", name: "Sion", role: "Baron", tier: "Unranked" },
  { id: "sivir", name: "Sivir", role: "Dragon", tier: "Unranked" },
  { id: "smolder", name: "Smolder", role: "Dragon", tier: "Unranked" },
  { id: "syndra", name: "Syndra", role: "Mid", tier: "Unranked" },
  { id: "talon", name: "Talon", role: "Jungle", tier: "Unranked" },
  { id: "teemo", name: "Teemo", role: "Baron", tier: "Unranked" },
  { id: "tristana", name: "Tristana", role: "Dragon", tier: "Unranked" },
  { id: "tryndamere", name: "Tryndamere", role: "Baron", tier: "Unranked" },
  { id: "twisted-fate", name: "Twisted Fate", role: "Mid", tier: "Unranked" },
  { id: "twitch", name: "Twitch", role: "Dragon", tier: "Unranked" },
  { id: "urgot", name: "Urgot", role: "Baron", tier: "Unranked" },
  { id: "varus", name: "Varus", role: "Dragon", tier: "Unranked" },
  { id: "vayne", name: "Vayne", role: "Dragon", tier: "Unranked" },
  { id: "veigar", name: "Veigar", role: "Mid", tier: "Unranked" },
  { id: "velkoz", name: "Vel'Koz", role: "Mid", tier: "Unranked" },
  { id: "vex", name: "Vex", role: "Mid", tier: "Unranked" },
  { id: "vi", name: "Vi", role: "Jungle", tier: "Unranked" },
  { id: "viego", name: "Viego", role: "Jungle", tier: "Unranked" },
  { id: "viktor", name: "Viktor", role: "Mid", tier: "Unranked" },
  { id: "vladimir", name: "Vladimir", role: "Mid", tier: "Unranked" },
  { id: "volibear", name: "Volibear", role: "Jungle", tier: "Unranked" },
  { id: "warwick", name: "Warwick", role: "Jungle", tier: "Unranked" },
  { id: "wukong", name: "Wukong", role: "Jungle", tier: "Unranked" },
  { id: "xayah", name: "Xayah", role: "Dragon", tier: "Unranked" },
  { id: "xin-zhao", name: "Xin Zhao", role: "Jungle", tier: "Unranked" },
  { id: "yasuo", name: "Yasuo", role: "Mid", tier: "Unranked" },
  { id: "yone", name: "Yone", role: "Mid", tier: "Unranked" },
  { id: "yunara", name: "Yunara", role: "Dragon", tier: "Unranked" },
  { id: "zed", name: "Zed", role: "Mid", tier: "Unranked" },
  { id: "zeri", name: "Zeri", role: "Dragon", tier: "Unranked" },
  { id: "ziggs", name: "Ziggs", role: "Mid", tier: "Unranked" },
  { id: "zoe", name: "Zoe", role: "Mid", tier: "Unranked" },

];

// ---- Academy coverage (Champion Matchups redesign, separation-of-
// concerns phase) ----
//
// CHAMPIONS above is the ONE canonical Champion registry -- every id in
// it is a real, resolvable identity: valid for image resolution
// (src/utils/images.js), valid as a Matchup target (src/data/
// matchups.js, functions/api/coach-overrides.js's validation), and
// valid for AI Coach/Patch Intelligence to recognize by name. That's
// deliberate and unchanged -- see requirement #2 in the redesign spec
// this section implements: "Do NOT solve this by deleting non-Support
// Champions from the canonical Champion registry."
//
// ACADEMY_COVERED_IDS is a SEPARATE, narrower concept: which of those
// champions Nyx NOONEdd Academy actually has coaching content for --
// appears in the Support Champion Tier List, the guide-browsing page,
// the homepage teaser, and Patch Intelligence's own roster snapshot.
// This is exactly the original 36-champion roster from before the
// Phase 3 "add every current Wild Rift champion so Matchups can
// reference them" expansion -- the 105 added in that phase have no
// blurb/builds (no coaching content was ever written for them) and are
// tagged with a lane role (Baron/Jungle/Mid/Dragon) rather than one of
// this roster's own Support sub-roles, both of which already implied
// the same distinction. This list makes that distinction EXPLICIT
// instead of relying on either of those as an inferred signal --
// deliberately not derived from role or from "has a blurb", so it
// can't silently change if either of those changes for an unrelated
// reason (e.g. editing a blurb, or a future role value).
//
// A champion NOT in this list is not invalid, not unusable, and not
// scheduled for removal -- it's fully valid everywhere identity/image/
// Matchup resolution is needed, just not presented as something Nyx
// NOONEdd Academy has written coaching content for. Adding real
// coverage for a champion (writing them a blurb/builds/tier, the way
// every one of the 36 already has) is the signal to add their id here
// too -- this list and "has real content" should always describe the
// same set; it isn't meant to diverge from that as its own separate
// judgment call.
const ACADEMY_COVERED_IDS = new Set([
  "alistar", "bard", "blitzcrank", "braum", "galio", "gragas", "janna", "jarvan-iv",
  "karma", "leona", "lulu", "lux", "maokai", "mel", "milio", "morgana", "nami",
  "nautilus", "norra", "ornn", "poppy", "pyke", "rakan", "rell", "senna", "seraphine",
  "sett", "skarner", "sona", "soraka", "swain", "taliyah", "thresh", "yuumi", "zilean", "zyra",
]);

/** True if Nyx NOONEdd Academy has actual coaching content for this
 *  champion (a real blurb/builds/tier judgment, not the "Unranked"
 *  placeholder every Matchup-only champion has) -- see
 *  ACADEMY_COVERED_IDS above for what this is and isn't. Accepts
 *  either a champion object (`{id}`) or a bare id string, so callers
 *  that already have the id on hand (e.g. functions/api/coach-
 *  overrides.js's validation) don't need to look up the object first. */
export function isAcademyCovered(champion) {
  const id = typeof champion === "string" ? champion : champion?.id;
  return ACADEMY_COVERED_IDS.has(id);
}
