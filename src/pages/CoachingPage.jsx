import { IconDiscord, IconTelegram } from "../components/icons.jsx";

export default function CoachingPage() {
  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Coaching</div>
          <h2>1-on-1 Support Coaching</h2>
          <p>VOD reviews, live duo sessions, and a personalized improvement plan.</p>
        </div>

        <div className="overview-text" style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: "1.35rem", fontWeight: 700, marginBottom: 16 }}>Why I Chose Support</h3>
          <p>I didn't start Nyx NOONEdd Academy because Wild Rift needed another list of builds, tier lists, or "best champions."</p>
          <p style={{ marginTop: 14 }}>There were already plenty of those.</p>
          <p style={{ marginTop: 14 }}>What was missing was the part that actually mattered to me: understanding why.</p>
          <p style={{ marginTop: 14 }}>Most guides could tell you what to build.</p>
          <p style={{ marginTop: 14 }}>They could tell you which champion was strong.</p>
          <p style={{ marginTop: 14 }}>They could tell you which rune to take.</p>
          <p style={{ marginTop: 14 }}>But the moment the game changed, a different matchup, a different team composition, a different patch, or simply a different situation, those answers often stopped being useful.</p>
          <p style={{ marginTop: 14 }}>Support is where that problem became impossible to ignore.</p>
          <p style={{ marginTop: 14 }}>You can play the same champion, build the same items, and still have completely different responsibilities from one game to another. Sometimes your job is to engage. Sometimes it is to peel. Sometimes you are creating vision and controlling space. Sometimes the best play is doing almost nothing until the enemy makes a mistake.</p>
          <p style={{ marginTop: 14 }}>That made me realize something:</p>
          <p style={{ marginTop: 14 }}><strong>Being a good Support isn't about memorizing the right answer. It's about learning how to find the right answer.</strong></p>
          <p style={{ marginTop: 14 }}>That became the foundation of Nyx NOONEdd Academy.</p>
          <p style={{ marginTop: 14 }}>I wanted to build something around decision-making rather than just recommendations — something that connects champions, items, runes, matchups, patches, and actual game situations into one system.</p>
          <p style={{ marginTop: 14 }}>The goal isn't to tell you, "Build this."</p>
          <p style={{ marginTop: 14 }}>It's to help you understand:</p>
          <p style={{ marginTop: 14 }}><strong>Why this? Why now? And what changes if the game changes?</strong></p>
          <p style={{ marginTop: 14 }}>That's the philosophy behind the Academy.</p>
          <p style={{ marginTop: 14 }}>And it's also why I'm building it as more than a guide site.</p>
          <p style={{ marginTop: 14 }}>The systems, the data, the coaching tools, and the AI Coach are all built around the same idea:</p>
          <p style={{ marginTop: 14 }}><strong>Teach the decision, not just the answer.</strong></p>
        </div>

        <div className="overview-text">
          <p>
            I'm Nyx "NOONEdd," and I've been playing the support role since Season 5, competing in
            tournaments along the way. My best ranked finish came in Season 8, where I hit Rank 18 in
            the support role (Rank 38 overall in EU). I've also coached a number of support players
            through Season 19.
          </p>
          <p style={{ marginTop: 14 }}>
            Across the champions I've played, I've held top-of-leaderboard spots consistently: top 1, 4,
            5, 6, and 7 on picks like Rakan, Thresh, and Sett, and top 50–100 on Senna, Karma, and most
            others. I was most active in ranked from Season 7 through Season 13; since then I've focused
            mainly on tournaments and scrims rather than solo queue.
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
          <a className="contact-row" href="https://t.me/NOONEdd67" target="_blank" rel="noopener noreferrer">
            <IconTelegram size={18} />
            <span><strong>Telegram:</strong> @NOONEdd67</span>
          </a>
          <div className="contact-row" style={{ marginTop: 8 }}>
            <IconDiscord size={18} />
            <span><strong>Discord:</strong> Nyx NOONE DD#3799</span>
          </div>
        </div>
      </div>
    </section>
  );
}
