import { ArrowRight } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { ROLE_ICONS, ROLE_COLORS } from "../data/constants.js";
import RankChip from "../components/RankChip.jsx";

export function GuidesPage({ champions }) {
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Champion Guides</div>
          <h2>Pick A Champion</h2>
          <p>Matchups, combos, and the macro calls that win lane.</p>
        </div>
        <div className="roster-grid">
          {champions.map((c) => (
            <RankChip key={c.id} id={c.id} name={c.name} tag={c.role} tier={c.tier} note={c.note}
              icon={ROLE_ICONS[c.role]} accent={ROLE_COLORS[c.role]} clickable _type="c" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="page-section">
      <div className="wrap" style={{ textAlign: "center" }}>
        <h2>Champion Not Found</h2>
        <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={() => navigate("/guides")}>
          Back To Guides <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
