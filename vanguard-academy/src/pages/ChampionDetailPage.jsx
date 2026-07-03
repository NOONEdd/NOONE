import { useState } from "react";
import { ArrowRight, Pencil, Sparkles } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { TIER_COLORS, ROLE_ICONS, ROLE_COLORS } from "../data/constants.js";
import { imgPath } from "../utils/images.js";
import BuildList from "../components/BuildList.jsx";

export default function ChampionDetailPage({ champion }) {
  const [tab, setTab] = useState("overview");
  const Icon = ROLE_ICONS[champion.role] || Sparkles;
  const accent = ROLE_COLORS[champion.role];
  const badgeDark = champion.tier === "Unranked" ? "#aab0d4" : "#04050c";
  const portraitSrc = imgPath(`c:${champion.id}`);

  return (
    <section className="page-section">
      <div className="wrap">
        <button className="back-link" onClick={() => navigate("/guides")}>
          <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} /> All Champions
        </button>

        <div className="detail-head" style={{ "--accent": accent }}>
          <div className="detail-icon">
            <Icon size={34} />
            {portraitSrc && (
              <img src={portraitSrc} alt="" className="chip-portrait" loading="lazy"
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
          </div>
          <div>
            <span className="chip-tag" style={{ position: "static", display: "inline-flex" }}>{champion.role}</span>
            <h1 className="detail-name">{champion.name}</h1>
            <p className="detail-blurb">{champion.blurb}</p>
          </div>
          <div className="detail-tier" style={{ background: TIER_COLORS[champion.tier], color: badgeDark }}>
            {champion.tier === "Unranked" ? "—" : champion.tier}
          </div>
        </div>

        <div className="tab-row">
          {["overview", "items", "runes", "matchups"].map((t) => (
            <button key={t} className={"tab-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
              {t === "overview" ? "Overview" : t === "items" ? "Items" : t === "runes" ? "Runes & Spells" : "Matchups"}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          champion.note ? (
            <div className="overview-text"><p>{champion.note}</p></div>
          ) : (
            <div className="placeholder-box">
              <Pencil size={16} />
              <p>No coach notes yet for {champion.name}.</p>
            </div>
          )
        )}
        {tab === "items" && <BuildList entries={champion.items} _type="i" emptyText={`No item notes yet for ${champion.name}.`} />}
        {tab === "runes" && <BuildList entries={champion.runes} _type="r" emptyText={`No rune or spell notes yet for ${champion.name}.`} />}
        {tab === "matchups" && <BuildList entries={champion.matchups} _type="c" emptyText={`No matchup notes yet for ${champion.name}.`} />}
      </div>
    </section>
  );
}
