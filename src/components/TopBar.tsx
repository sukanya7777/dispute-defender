"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Disputes" },
  { href: "/store", label: "Demo store" },
  { href: "/settings", label: "Rules & autopilot" },
];

export function TopBar() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/disputes") : path.startsWith(href));
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z" />
              <path d="M8.5 12l2.5 2.5 4.5-5" />
            </svg>
          </span>
          Dispute Defender
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={active(l.href) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
