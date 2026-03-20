"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const tabs = [
  { href: "/roster", label: "Roster" },
  { href: "/teams", label: "Teams" },
  { href: "/matchup-tinder", label: "Matchup Tinder" },
  { href: "/matchup-visualizer", label: "Matchup Visualizer" }
];

export function AppShell({
  title,
  copy,
  children,
  showNav = true,
  headerActions = null,
  shellClassName = "",
  frameClassName = "",
  headerClassName = ""
}: {
  title: string;
  copy: ReactNode;
  children: ReactNode;
  showNav?: boolean;
  headerActions?: ReactNode;
  shellClassName?: string;
  frameClassName?: string;
  headerClassName?: string;
}) {
  const pathname = usePathname();

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
          {headerActions || showNav ? (
            <div className="page-header-side">
              {headerActions}
              {showNav ? (
                <nav className="tabs" aria-label="Primary">
                  {tabs.map((tab) => {
                    const active = pathname === tab.href;
                    return (
                      <Link key={tab.href} className={`tab${active ? " active" : ""}`} href={tab.href}>
                        {tab.label}
                      </Link>
                    );
                  })}
                </nav>
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
