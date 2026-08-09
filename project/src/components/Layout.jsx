import { useState, useEffect } from "react";
import { Menu, X, ArrowRight, ArrowUp } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { NAV_LINKS } from "../data/constants.js";

export function FeatureCard({ icon, accent, title, text, onClick, linkLabel }) {
  return (
    <div className="feature-card" style={{ "--c": accent }} onClick={onClick}>
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="card-link">{linkLabel} <ArrowRight size={13} /></span>
    </div>
  );
}

export function Logo() {
  return (
    <button className="logo" onClick={() => navigate("/")} aria-label="Nyx NOONEdd Academy home">
      <svg className="logo-mark" viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0" stopColor="#1fd0ff" />
            <stop offset="1" stopColor="#ff5fc1" />
          </linearGradient>
        </defs>
        <path d="M24 3 L43 13 V33 L24 45 L5 33 V13 Z" stroke="url(#logoGrad)" strokeWidth="2.4" fill="rgba(155,107,255,.08)" />
        <path d="M16 22 L24 32 L34 16" stroke="url(#logoGrad)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="logo-text-block">
        <span className="logo-text">NYX NOONEDD</span>
        <span className="logo-tagline">Academy</span>
      </span>
    </button>
  );
}

export function NavBar({ currentPage, menuOpen, setMenuOpen }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 30); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={scrolled ? "is-scrolled" : ""}>
      <div className="wrap nav-inner">
        <Logo />
        <ul className="nav-links">
          {NAV_LINKS.map((l) => (
            <li key={l.page}>
              <button className={currentPage === l.page ? "active" : ""} onClick={() => navigate(l.path)}>{l.label}</button>
            </li>
          ))}
        </ul>
        <div className="nav-right">
          <button className="btn btn-primary btn-small" onClick={() => navigate("/coaching")}>
            Start Climbing <ArrowRight size={14} />
          </button>
          <button className="nav-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
    </nav>
  );
}

export function MobileMenu({ onNavigate }) {
  return (
    <div className="mobile-menu">
      {NAV_LINKS.map((l) => (
        <button key={l.path} onClick={() => { navigate(l.path); onNavigate(); }}>{l.label}</button>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p>Tier lists, item builds, rune pages, and coaching for Wild Rift support mains — meta picks and off-meta flex alike.</p>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <ul>
              <li><button onClick={() => navigate("/tierlist")}>Champion Tier List</button></li>
              <li><button onClick={() => navigate("/items")}>Item Tier List</button></li>
              <li><button onClick={() => navigate("/runes")}>Rune Tier List</button></li>
              <li><button onClick={() => navigate("/guides")}>Champion Guides</button></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Coaching</h4>
            <ul>
              <li><button onClick={() => navigate("/coaching")}>1-on-1 Sessions</button></li>
              <li><button onClick={() => navigate("/coaching")}>VOD Review</button></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <ul>
              <li><button onClick={() => navigate("/")}>About</button></li>
              <li><button onClick={() => navigate("/coaching")}>Contact</button></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Nyx NOONEdd Academy. Fan-made project — not affiliated with or endorsed by Riot Games.</span>
        </div>
      </div>
    </footer>
  );
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    function onScroll() { setShow(window.scrollY > 700); }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button id="toTop" className={show ? "show" : ""} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
      <ArrowUp size={18} />
    </button>
  );
}
