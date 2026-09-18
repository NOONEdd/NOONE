import { ArrowRight, Play, Swords, Shield, BookOpen } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { useHeroParallax } from "../hooks/useHeroParallax.js";
import { useRosterRotation } from "../hooks/useRosterRotation.js";
import { ROLE_ICONS, ROLE_COLORS } from "../data/constants.js";
import { FeatureCard } from "../components/Layout.jsx";
import RankChip from "../components/RankChip.jsx";
import { IconGem } from "../components/icons.jsx";
import { ITEMS } from "../data/items.js";
import { RUNES } from "../data/runes.js";

// Home-page stat pills use a conservative "rounded down to the nearest ten,
// plus a +" marketing style (e.g. "80+ Items") rather than the exact count,
// matching this section's existing display convention. Flooring means the
// claim is never an overstatement even as items/runes are added over time.
function roundedDownTen(count) {
  return Math.floor(count / 10) * 10;
}

// How many cards the "Full Roster Coverage" teaser shows at once -- this is
// purely a display cap, never a bound on the roster itself. `champions`
// (App.jsx's `academyChampions`) is whatever the Academy currently covers,
// however many that is; useRosterRotation cycles through all of it.
const ROSTER_TEASER_SIZE = 8;

// Owns useRosterRotation's state itself, in its own component, rather than
// inline in HomePage -- the rotation ticks every 4.2s for as long as the
// Home page is mounted, and React re-renders start from wherever the
// changed state actually lives. Keeping that state here means only this
// small subtree (8 cards) re-renders on each tick; the hero, feature grid,
// and CTA banner above/below it never re-execute their render just because
// a roster card faded. No memoization needed to achieve this -- it's a
// consequence of where the state lives, not a fix applied on top of it.
function RosterTeaser({ champions }) {
  const rosterSlots = useRosterRotation(champions, ROSTER_TEASER_SIZE);
  return (
    <div className="roster-grid">
      {rosterSlots.map((slot, i) => (
        <div key={i} className={"roster-slot" + (slot.phase === "visible" ? "" : " roster-slot-offstage")}>
          <RankChip key={slot.champion.id} id={slot.champion.id} name={slot.champion.name} tag={slot.champion.role} tier={slot.champion.tier} note={slot.champion.note}
            icon={ROLE_ICONS[slot.champion.role]} accent={ROLE_COLORS[slot.champion.role]} clickable _type="c" />
        </div>
      ))}
    </div>
  );
}

export default function HomePage({ champions }) {
  useHeroParallax();

  return (
    <>
      <header className="hero">
        <div className="hero-bg">
          <div className="hero-orb orb-1" />
          <div className="hero-orb orb-2" />
          <div className="hero-orb orb-3" />
          <div className="streak s1" />
          <div className="streak s2" />
          <div className="streak s3" />
          <div className="hero-floor" />
        </div>
        <div className="wrap hero-content">
          <div className="eyebrow"><span className="dot" />A Support Academy — Not Another Database</div>
          <h1>
            <span className="l1">Stop Memorizing Builds.</span>
            <span className="l2">Start Reading The Game.</span>
          </h1>
          <p className="lead">
            Champion tiers, item builds, and rune pages are all here — but that's not the point.
            Nyx NOONEdd Academy exists to teach the decisions behind them: when to engage, when to roam,
            when to hold vision, and why. You'll leave understanding the call, not just copying it.
          </p>
          <div className="hero-cta-row">
            <button className="btn btn-primary" onClick={() => navigate("/tierlist")}>
              Explore Tier Lists <ArrowRight size={15} />
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/coaching")}>
              <Play size={15} /> Meet Your Coach
            </button>
          </div>
          <div className="hero-stats">
            <div className="stat"><span className="stat-num">{champions.length}</span><span className="stat-label">Champions Covered</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-num">{roundedDownTen(ITEMS.length)}+</span><span className="stat-label">Items Tracked</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-num">{roundedDownTen(RUNES.length)}+</span><span className="stat-label">Runes Tracked</span></div>
          </div>
        </div>
      </header>

      <section className="page-section">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow"><span className="dot" />Your Toolkit</div>
            <h2>Everything A Support Main Needs</h2>
            <p>Built for climbing, not just for browsing.</p>
          </div>
          <div className="features-grid">
            <FeatureCard icon={<Swords size={24} />} accent="#1fd0ff" title="Champion Tier List"
              text="Every support and flex pick, ranked with real coaching reasoning."
              onClick={() => navigate("/tierlist")} linkLabel="View Rankings" />
            <FeatureCard icon={<Shield size={24} />} accent="#9b6bff" title="Item Tier List"
              text="Support, defense, boots, enchant, magic, and physical items, side by side."
              onClick={() => navigate("/items")} linkLabel="Browse Items" />
            <FeatureCard icon={<IconGem size={24} />} accent="#f3c969" title="Rune Tier List"
              text="Every keystone and minor rune, organized by real Wild Rift path."
              onClick={() => navigate("/runes")} linkLabel="Browse Runes" />
            <FeatureCard icon={<BookOpen size={24} />} accent="#ff5fc1" title="Champion Guides"
              text="Matchups, combos, and the macro calls that actually win lane."
              onClick={() => navigate("/guides")} linkLabel="Read Guides" />
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow"><span className="dot" />Full Roster Coverage</div>
            <h2>From Enchanters To Off-Meta Flex Picks</h2>
            <p>If it can hold a lane from the back line, it's in here.</p>
          </div>
          <RosterTeaser champions={champions} />
          <div className="center-cta">
            <button className="btn btn-ghost" onClick={() => navigate("/guides")}>View Full Roster <ArrowRight size={15} /></button>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <div className="glow-behind" />
        <div className="wrap">
          <h2>Ready To Carry From The Back Line?</h2>
          <p>Tier lists update every patch. Coaching slots are limited.</p>
          <button className="btn btn-primary" onClick={() => navigate("/coaching")}>Start Your Climb <ArrowRight size={15} /></button>
        </div>
      </section>
    </>
  );
}
