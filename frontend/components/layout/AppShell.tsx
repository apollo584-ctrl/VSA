"use client";

import { BookOpen, ChevronsLeft, ChevronsRight, GitBranch, History, Lightbulb, LayoutDashboard, LineChart, Settings, Waves, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { HistoryRecorder } from "./HistoryRecorder";

export const NAV: { href: string; label: string; icon: LucideIcon; match?: (p: string) => boolean }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/chart", label: "Chart & Profile", icon: LineChart },
  { href: "/vsa", label: "VSA Analysis", icon: Waves },
  { href: "/auction", label: "Auction Structure", icon: GitBranch },
  { href: "/interpretation", label: "Interpretation", icon: Lightbulb },
  { href: "/knowledge", label: "Knowledge Explorer", icon: BookOpen, match: (p) => p.startsWith("/knowledge") },
  { href: "/history", label: "Analysis History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Sidebar() {
  const pathname = usePathname();
  const { state, set } = useWorkspace();
  const collapsed = state.navCollapsed;
  return (
    <nav aria-label="Primary" className={cn("flex shrink-0 flex-col border-r border-border bg-surface py-2 transition-[width] max-md:w-12", collapsed ? "w-12" : "w-52")}>
      <ul className="flex flex-1 flex-col gap-0.5 px-1.5">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match ? match(pathname) : pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2 text-xs font-medium transition-colors",
                  active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon size={16} aria-hidden className="shrink-0" />
                <span className={cn(collapsed && "sr-only", "max-md:sr-only")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => set({ navCollapsed: !collapsed })}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!collapsed}
        className="mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-2 text-xs text-subtle hover:bg-surface-2 hover:text-fg max-md:hidden"
      >
        {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /><span>Collapse</span></>}
      </button>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 overflow-auto p-3" tabIndex={-1}>{children}</main>
      </div>
      <StatusBar />
      <HistoryRecorder />
    </div>
  );
}
