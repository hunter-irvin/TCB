"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const tabs = [
  { href: "/roster", label: "Roster" },
  { href: "/teams", label: "Teams" }
];

export function AppShell({
  title,
  copy,
  children
}: {
  title: string;
  copy: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className="shell">
      <div className="page-frame">
        <header className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <p className="page-copy">{copy}</p>
          </div>
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
        </header>
        {children}
      </div>
    </main>
  );
}
