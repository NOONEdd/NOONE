import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { roleDisplay, tierDisplay } from "../data/constants.js";
import { candidatePaths } from "../utils/images.js";
import SmartImage from "../components/SmartImage.jsx";
import BuildBoard from "../components/BuildBoard.jsx";
import { CoachToggle } from "../components/TierBoard.jsx";
import { PatchStatusPill } from "../components/PatchStatus.jsx";
import DecisionTreePanel from "../components/DecisionTreePanel.jsx";
import BuildEditor from "../components/BuildEditor.jsx";
import ChampionMatchups from "../components/ChampionMatchups.jsx";

export default function ChampionDetailPage({
  champion, editMode, setEditMode, syncStatus, auth, currentPatch, patchStatus,
  decisionTrees, onAddDecisionTree, onUpdateDecisionTree, onDeleteDecisionTree,
  onUpdateChampionBuilds, roster, onUpdateChampionMatchups,
}) {
  const [tab, setTab] = useState("build");
  const [selectedBuild, setSelectedBuild] = useState(0);
  const displayContext = { dataset: "champions", entityId: champion.id, entityName: champion.name };
  const { icon: Icon, color: accent } = roleDisplay(champion.role, displayContext);
  const tierColor = tierDisplay(champion.tier, displayContext).color;
  const badgeDark = champion.tier === "Unranked" ? "#aab0d4" : "#04050c";
  const portraitPaths = candidatePaths(`c:${champion.id}`);
  // NOTE: must check .length, not just truthiness -- resolveEffectiveChampion()
  // (src/lib/effectiveData.js) always sets `builds` to an array (defaulting to
  // `[]` when a champion has no populated `builds` yet), and `[] || fallback`
  // never falls through in JS since an empty array is truthy. This now matches
  // the same non-empty check functions/_lib/extractChampionContext.js already
  // uses for the exact same fallback on the AI Coach side.
  const builds = champion.builds && champion.builds.length > 0
    ? champion.builds
    : [{ name: "Default", items: champion.items, runes: champion.runes }];

  // selectedBuild is page state that survives navigating straight from one champion to another (e.g. via a Matchups pill:
  // same component, new `champion` prop), so it can point past the new champion's builds -- clamp it to the first build
  // (for the board, the highlighted button and the editor alike) instead of reading `.items` of undefined.
  const buildIndex = selectedBuild < builds.length ? selectedBuild : 0;
  const currentBuild = builds[buildIndex];
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
          <div className="detail-tier" style={{ background: tierColor, color: badgeDark }}>
            {champion.tier === "Unranked" ? "—" : champion.tier}
          </div>
        </div>

        {/* Always visible — short enough that hiding it behind a tab just costs an extra click for no reason */}
        {champion.note && <p className="detail-blurb-standalone">{champion.note}</p>}

        {currentPatch && (
          <p className="save-note" style={{ margin: "-8px 0 16px" }}>
            Patch {currentPatch} <PatchStatusPill status={patchStatus} />
          </p>
        )}

        <div className="tab-row">
          {["build", "matchups", "decisiontrees"].map((t) => (
            <button key={t} className={"tab-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
              {t === "build" ? "Build" : t === "matchups" ? "Matchups" : "Decision Trees"}
            </button>
          ))}
        </div>

        {tab === "build" && (
          <>
            <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} />

            <div className="build-select">
              {builds.map((build, index) => (
                <button
                  key={index}
                  className={buildIndex === index ? "active" : ""}
                  onClick={() => setSelectedBuild(index)}
                >
                  {build.name}
                </button>
              ))}
            </div>

            {editMode ? (
              <BuildEditor
                builds={builds}
                selectedBuild={buildIndex}
                onSelectBuild={setSelectedBuild}
                onChangeBuilds={onUpdateChampionBuilds}
              />
            ) : (
              <BuildBoard
                items={currentBuild.items}
                runes={currentBuild.runes}
                emptyText={`No build notes yet for ${champion.name}.`}
              />
            )}
          </>
        )}

        {tab === "matchups" && (
          <>
            <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} />
            <ChampionMatchups
              championId={champion.id}
              matchupRelations={champion.matchupRelations}
              roster={roster}
              editMode={editMode}
              onChange={onUpdateChampionMatchups}
            />
          </>
        )}

        {tab === "decisiontrees" && (
          <>
            <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} />
            <DecisionTreePanel
              championName={champion.name}
              entries={decisionTrees}
              editMode={editMode}
              onAdd={onAddDecisionTree}
              onUpdate={onUpdateDecisionTree}
              onDelete={onDeleteDecisionTree}
            />
          </>
        )}
      </div>
    </section>
  );
}
