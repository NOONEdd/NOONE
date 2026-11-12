// Riot-shaped inputs for tests/patchNotesIdentity.test.mjs -- together they exercise every ownership path the extractor has:
// entity heading, explicit "<Name> / Base Stats" sub-blocks, lifecycle lists (added / removed), entity subsections,
// ambiguous shared headings, untracked entity-shaped blocks (new candidate / unmatched), and system sections.
export const ALL_PATHS_PAGE = `# Wild Rift Patch Notes 9.1

New items like Mystery Blade are joining the shop.

## CHAMPION ADJUSTMENTS

### Leona

Q - Shield of Daybreak

- Damage: 60 / 100 / 140 / 180 → 70 / 110 / 150 / 190

### Ezreal

- Base Health: 600 → 620

### Lulu and Janna

- Movement Speed: 330 → 335

### Champion Durability Adjustments Detailed List

#### Senna

*Base Stats*

- Base Health: 600 → 570

## ITEM ADJUSTMENTS

### Ardent Censer

- Attack Speed: 20% → 25%

### Support Item Adjustments

Harmonic Echo
Base Stats
- Health: 300 → 350
Bulwark of the Mountain
Base Stats
- Shield: 120 → 140

### Mystery Blade

- Price: 3000

### Black Mist Scythe

- Bonus Damage: 40 → 50

#### Items Removed

- These items are leaving the shop.
  - Searing Crown
  - Knight's Vow

## RUNE ADJUSTMENTS

### Aery

- Damage: 10 → 12

## GAMEPLAY CHANGES

### Bulwark of the Mountain

- Shield: 120 → 140

## BATTLEFIELD ADJUSTMENTS

### Jungle Adjustments

- [Removed] Monster gold scaling.

### ARAM Augment Sets

#### Heartsteel

- Bonus Health: 100 → 120
`;
