import { useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { AppView } from "./pages/AppView";

/**
 * Routing is a two-route switch rather than a router dependency.
 *
 * `/`      the marketing page
 * `/app`   the GUI, one session
 * `/app/<sessionId>` the GUI, bound to a named session
 *
 * There are exactly two pages and a path segment. A router would be a
 * dependency that exists to route between two things.
 */
function parseRoute(): { page: "landing" | "app"; sessionId: string } {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const appMatch = /^\/app(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(path);
  if (appMatch) {
    return { page: "app", sessionId: appMatch[1] ?? defaultSessionId() };
  }
  return { page: "landing", sessionId: defaultSessionId() };
}

/** A stable session id for the default workspace, so a reload resumes. */
function defaultSessionId(): string {
  const KEY = "milo.session";
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = `local-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return "local-default";
  }
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Scroll to top on a page change. Without this, arriving at /app from a
  // scrolled marketing page lands you halfway down the GUI.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.page]);

  return route.page === "app" ? <AppView sessionId={route.sessionId} /> : <Landing />;
}
