"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRun } from "@/components/run-provider";
import {
  RUNS,
  buildRunPath,
  getRunPageFromPathname,
  persistRunSlug,
  type RunPage
} from "@/lib/runs";

const tabs: Array<{ page: RunPage; label: string }> = [
  { page: "roster", label: "Roster" },
  { page: "teams", label: "Teams" },
  { page: "matchup-tinder", label: "Matchup Tinder" },
  { page: "matchup-visualizer", label: "Matchup Visualizer" }
];

export function AppShell({
  title,
  copy,
  children,
  showNav = true,
  showRunSwitcher = true,
  headerActions = null,
  shellClassName = "",
  frameClassName = "",
  headerClassName = ""
}: {
  title: string;
  copy: ReactNode;
  children: ReactNode;
  showNav?: boolean;
  showRunSwitcher?: boolean;
  headerActions?: ReactNode;
  shellClassName?: string;
  frameClassName?: string;
  headerClassName?: string;
}) {
  const { run } = useRun();
  const pathname = usePathname();
  const activePage = getRunPageFromPathname(pathname);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const runSwitcherRef = useRef<HTMLDivElement | null>(null);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRunMenuOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!runMenuOpen && !mobileNavOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideRunSwitcher = runSwitcherRef.current?.contains(target);
      const insideMobileNav = mobileNavRef.current?.contains(target);

      if (!insideRunSwitcher) {
        setRunMenuOpen(false);
      }

      if (!insideMobileNav) {
        setMobileNavOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRunMenuOpen(false);
        setMobileNavOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen, runMenuOpen]);

  return (
    <main className={["shell", shellClassName].filter(Boolean).join(" ")}>
      <div className={["page-frame", frameClassName].filter(Boolean).join(" ")}>
        <header
          className={[
            "page-header",
            copy ? "with-copy" : "no-copy",
            headerClassName
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div>
            <h1 className="page-title">{title}</h1>
          </div>
          {headerActions || showNav || showRunSwitcher ? (
            <div className="page-header-side">
              {headerActions}
              {(showNav || showRunSwitcher) ? (
                <div ref={mobileNavRef} className="mobile-nav">
                  <button
                    type="button"
                    className={`mobile-nav-toggle${mobileNavOpen ? " open" : ""}`}
                    aria-label={`Open navigation menu. Current run: ${run.name}`}
                    aria-expanded={mobileNavOpen}
                    aria-haspopup="menu"
                    onClick={() => setMobileNavOpen((current) => !current)}
                  >
                    <span className="mobile-nav-toggle-lines" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>
                  {mobileNavOpen ? (
                    <div className="mobile-nav-menu" role="menu" aria-label="Navigation">
                      {showNav ? (
                        <div className="mobile-nav-section">
                          <div className="mobile-nav-section-title">Pages</div>
                          <div className="mobile-nav-links">
                            {tabs.map((tab) => {
                              const href = buildRunPath(run.slug, tab.page);
                              const active = activePage === tab.page;
                              return (
                                <Link
                                  key={href}
                                  href={href}
                                  className={`mobile-nav-link${active ? " active" : ""}`}
                                  role="menuitem"
                                  onClick={() => setMobileNavOpen(false)}
                                >
                                  {tab.label}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {showRunSwitcher ? (
                        <div className="mobile-nav-section">
                          <div className="mobile-nav-section-title">Runs</div>
                          <div className="mobile-nav-links">
                            {RUNS.map((candidate) => (
                              <Link
                                key={candidate.slug}
                                href={buildRunPath(candidate.slug, "roster")}
                                className={`mobile-nav-link run${candidate.slug === run.slug ? " active" : ""}`}
                                role="menuitem"
                                onClick={() => {
                                  persistRunSlug(candidate.slug);
                                  setMobileNavOpen(false);
                                }}
                              >
                                <span className="mobile-nav-run-badge" aria-hidden="true">
                                  {candidate.initials}
                                </span>
                                <span>{candidate.name}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showNav ? (
                <nav className="tabs" aria-label="Primary">
                  {tabs.map((tab) => {
                    const href = buildRunPath(run.slug, tab.page);
                    const active = activePage === tab.page;
                    return (
                      <Link key={href} className={`tab${active ? " active" : ""}`} href={href}>
                        {tab.label}
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
              {showRunSwitcher ? (
                <div ref={runSwitcherRef} className="run-switcher">
                  <button
                    type="button"
                    className={`run-switcher-button${runMenuOpen ? " open" : ""}`}
                    aria-label={`Switch run. Current run: ${run.name}`}
                    aria-expanded={runMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setRunMenuOpen((current) => !current)}
                  >
                    {run.initials}
                  </button>
                  {runMenuOpen ? (
                    <div className="run-switcher-menu" role="menu" aria-label="Runs">
                      {RUNS.map((candidate) => (
                        <Link
                          key={candidate.slug}
                          href={buildRunPath(candidate.slug, "roster")}
                          className={`run-switcher-option${candidate.slug === run.slug ? " active" : ""}`}
                          role="menuitem"
                          onClick={() => {
                            persistRunSlug(candidate.slug);
                            setRunMenuOpen(false);
                          }}
                        >
                          <span className="run-switcher-option-badge" aria-hidden="true">
                            {candidate.initials}
                          </span>
                          <span className="run-switcher-option-name">{candidate.name}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </header>
        {copy ? <div className="page-copy page-copy-block">{copy}</div> : null}
        {children}
      </div>
    </main>
  );
}
