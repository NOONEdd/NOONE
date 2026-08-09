import { Component } from "react";
import { RefreshCw } from "lucide-react";

/** Wraps the currently-active PAGE only (not the whole app) -- see how
 *  it's used in App.jsx, around {content} inside <main>, not around
 *  <NavBar>/<Footer> too. That scoping is deliberate: if one page's
 *  render throws, the visitor still sees a working header/nav and can
 *  click away to a page that isn't broken, instead of the entire site
 *  going blank. A render error anywhere else in the tree (Layout itself,
 *  or main.jsx) is not caught here and would still blank the page --
 *  this covers the common case (bad data on one specific page) rather
 *  than being a total safety net for every conceivable failure. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Goes to the browser console / Cloudflare's real-time logs, not
    // anywhere user-visible -- this is a debugging aid for whoever
    // maintains the site, not something a visitor sees.
    console.error("[ErrorBoundary] Caught a render error:", error, info);
  }

  componentDidUpdate(prevProps) {
    // If the route changes while showing the fallback (visitor clicked a
    // nav link), drop back into normal rendering for the new page instead
    // of staying stuck on the fallback forever.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <h2>This page hit a snag.</h2>
          <p>Something on this specific page failed to load correctly. Refreshing usually fixes it.</p>
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
