"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const tabs = [
  { href: "/roster", label: "Roster" },
  { href: "/teams", label: "Teams" },
  { href: "/matchup-tinder", label: "Matchup Tinder" }
];

export function AppShell({
  title,
  copy,
  children,
  showNav = true
}: {
  title: string;
  copy: ReactNode;
  children: ReactNode;
  showNav?: boolean;
}) {
  const pathname = usePathname();

  return (
    <main className="shell">
      <div className="page-frame">
        <header className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <div className="page-copy">{copy}</div>
          </div>
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
        </header>
        {children}
      </div>
    </main>
  );
}
