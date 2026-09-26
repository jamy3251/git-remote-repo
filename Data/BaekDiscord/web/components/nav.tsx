"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "홈" },
  { href: "/teams", label: "팀 다이제스트" },
  { href: "/console", label: "CLI 콘솔" },
  { href: "/compile", label: "컴파일러" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold tracking-tight text-foreground">
          DevHub
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1 transition ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs text-muted">v0.1 · 로컬 러너 · M1</div>
      </div>
    </header>
  );
}
