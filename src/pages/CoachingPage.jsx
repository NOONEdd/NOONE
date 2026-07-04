import { Pencil } from "lucide-react";

export default function CoachingPage() {
  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Coaching</div>
          <h2>1-on-1 Support Coaching</h2>
          <p>VOD reviews, live duo sessions, and a personalized improvement plan.</p>
        </div>

        <div className="placeholder-box" style={{ marginBottom: 28 }}>
          <Pencil size={16} />
          <p>This is where my story goes — why Support, what was missing from every guide I'd read, and the philosophy behind Vanguard Academy. Writing that properly soon. For now, here's the track record.</p>
        </div>

        <div className="overview-text">
          <p>
            I'm Nyx "NOONEdd," and I've been playing the support role since Season 5 — competing in
            tournaments along the way and picking up some strong results. In Season 8, I hit Rank 18 in
            the support role (Rank 38 overall in EU). I coached a number of support players through
            Season 19.
          </p>
          <p style={{ marginTop: 14 }}>
            Across my time playing, I've held top-of-leaderboard spots on a wide range of champions —
            top 1, 4, 5, 6, and 7 on picks like Rakan, Thresh, and Sett, and top 50–100 on Senna, Karma,
            and most other supports I've played. I was most active in ranked from Season 7 through
            Season 13; since then I've focused mainly on tournaments and scrims rather than solo queue.
          </p>
        </div>

        <div className="hero-stats" style={{ marginTop: 32 }}>
          <div className="stat"><span className="stat-num">S5+</span><span className="stat-label">Playing Support</span></div>
          <div className="stat-divider" />
          <div className="stat"><span className="stat-num">#18</span><span className="stat-label">Support, Season 8</span></div>
          <div className="stat-divider" />
          <div className="stat"><span className="stat-num">S19</span><span className="stat-label">Coached Players</span></div>
        </div>

        <div className="overview-text" style={{ marginTop: 32 }}>
          <p><strong>Telegram:</strong> @NOONEdd67</p>
          <p style={{ marginTop: 8 }}><strong>Discord:</strong> Nyx NOONE DD#3799</p>
        </div>
      </div>
    </section>
  );
}
