"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "홈" },
  { href: "/control", label: "관제" },
  { href: "/teams", label: "팀 다이제스트" },
  { href: "/console", label: "CLI 콘솔" },
  { href: "/compile", label: "컴파일러" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="shrink-0 font-semibold tracking-tight text-foreground">
          DevHub
        </Link>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <div className="ml-auto hidden shrink-0 text-xs text-muted sm:block">v0.2 · 로컬 러너 · M1</div>
      </div>
    </header>
  );
}
