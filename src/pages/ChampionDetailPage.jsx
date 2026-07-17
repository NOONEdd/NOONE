import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { TIER_COLORS, ROLE_ICONS, ROLE_COLORS } from "../data/constants.js";
import { candidatePaths } from "../utils/images.js";
import SmartImage from "../components/SmartImage.jsx";
import BuildList from "../components/BuildList.jsx";
import BuildBoard from "../components/BuildBoard.jsx";

export default function ChampionDetailPage({ champion }) {
  const [tab, setTab] = useState("build");
  const Icon = ROLE_ICONS[champion.role] || Sparkles;
  const accent = ROLE_COLORS[champion.role];
  const badgeDark = champion.tier === "Unranked" ? "#aab0d4" : "#04050c";
  const portraitPaths = candidatePaths(`c:${champion.id}`);

  return (
    <section className="page-section">
      <div className="wrap">
        <button className="back-link" onClick={() => navigate("/guides")}>
          <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} /> All Champions
        </button>

        <div className="detail-head" style={{ "--accent": accent }}>
          <div className="detail-icon">
            <Icon size={34} />
            {portraitPaths.length > 0 && <SmartImage basePath={portraitPaths} alt={champion.name} className="chip-portrait" />}
          </div>
          <div>
            <span className="chip-tag" style={{ position: "static", display: "inline-flex" }}>{champion.role}</span>
            <h1 className="detail-name">{champion.name}</h1>
          </div>
          <div className="detail-tier" style={{ background: TIER_COLORS[champion.tier], color: badgeDark }}>
            {champion.tier === "Unranked" ? "—" : champion.tier}
          </div>
        </div>

        {/* Always visible — short enough that hiding it behind a tab just costs an extra click for no reason */}
        {champion.note && <p className="detail-blurb-standalone">{champion.note}</p>}

        <div className="tab-row">
          {["build", "matchups"].map((t) => (
            <button key={t} className={"tab-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
              {t === "build" ? "Build" : "Matchups"}
            </button>
          ))}
        </div>

        {tab === "build" && (
          <BuildBoard items={champion.items} runes={champion.runes} emptyText={`No build notes yet for ${champion.name}.`} />
        )}
        {tab === "matchups" && (
          <BuildList entries={champion.matchups} _type="c" emptyText={`No matchup notes yet for ${champion.name}.`} />
        )}
      </div>
    </section>
  );
}
