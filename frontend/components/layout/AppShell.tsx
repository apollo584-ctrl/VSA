"use client";

import { BellRing, BookOpen, BookText, ChevronsLeft, ChevronsRight, GitBranch, History, Lightbulb, LayoutDashboard, LineChart, PanelLeft, Radar, FlaskConical, Settings, Waves, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { CapabilitySync } from "./CapabilitySync";
import { HistoryRecorder } from "./HistoryRecorder";

type NavItem = { href: string; label: string; icon: LucideIcon; match?: (p: string) => boolean };

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Analysis",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/chart", label: "Chart & Profile", icon: LineChart },
      { href: "/vsa", label: "VSA Analysis", icon: Waves },
      { href: "/auction", label: "Auction Structure", icon: GitBranch },
      { href: "/interpretation", label: "Interpretation", icon: Lightbulb },
      { href: "/scan", label: "Scanner", icon: Radar },
      { href: "/outcomes", label: "Pattern Stats", icon: FlaskConical },
      { href: "/signals", label: "Signals", icon: BellRing },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/knowledge", label: "Knowledge Explorer", icon: BookOpen, match: (p) => p.startsWith("/knowledge") },
      { href: "/glossary", label: "Glossary", icon: BookText },
      { href: "/history", label: "Analysis History", icon: History },
    ],
  },
];
/** Dashboard-style tabs that fit one screen on wide displays; their panels scroll inside themselves. */
const FIT_ROUTES = new Set(["/", "/chart", "/vsa", "/auction"]);
const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings };
export const NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS];

function NavLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const { href, label, icon: Icon, match } = item;
  const active = match ? match(pathname) : pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon size={18} aria-hidden className="shrink-0" />
      <span className={cn(collapsed && "sr-only", "max-md:sr-only")}>{label}</span>
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { state, set } = useWorkspace();
  const collapsed = state.navCollapsed;
  return (
    <nav aria-label="Primary" className={cn("relative flex shrink-0 flex-col border-r border-border bg-surface transition-[width] max-md:w-16", collapsed ? "w-16" : "w-64")}>
      <div className={cn("flex h-16 shrink-0 items-center gap-2 px-3", collapsed && "flex-col justify-center gap-1 px-0")}>
        <Link href="/" aria-label="Market Structure home" className={cn("flex min-w-0 flex-1 items-center gap-3 px-1", collapsed && "flex-none justify-center px-0")}>
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-value text-sm font-bold text-white shadow-sm">MS</span>
          <span className={cn("min-w-0 leading-tight", collapsed && "sr-only", "max-md:sr-only")}>
            <span className="block text-sm font-semibold text-fg">Market Structure</span>
            <span className="block text-xs text-subtle">Analysis terminal</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => set({ navCollapsed: !collapsed })}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-subtle hover:bg-surface-2 hover:text-fg max-md:hidden"
        >
          <PanelLeft size={17} aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pt-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className={cn("mb-2 px-3 text-xs font-medium text-subtle", collapsed && "sr-only", "max-md:sr-only")}>{group.label}</p>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => <li key={item.href}><NavLink item={item} collapsed={collapsed} pathname={pathname} /></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        <NavLink item={SETTINGS} collapsed={collapsed} pathname={pathname} />
        <button
          type="button"
          onClick={() => set({ navCollapsed: !collapsed })}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-subtle hover:bg-surface-2 hover:text-fg max-md:hidden", collapsed && "justify-center px-0")}
        >
          {collapsed ? <ChevronsRight size={18} aria-hidden /> : <><ChevronsLeft size={18} aria-hidden /><span>Collapse</span></>}
        </button>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // Dashboard tabs fit one screen on wide displays: the wrapper takes the full height and panels scroll inside themselves.
  const pathname = usePathname();
  const fit = FIT_ROUTES.has(pathname);
  // The pop-out chart window is chart-only: no sidebar, top bar or status bar.
  if (pathname.startsWith("/chart/popout")) return <>{children}</>;
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* relative: contains absolutely positioned descendants (sr-only text, tooltips), which would otherwise extend the window scroll. */}
        <main id="main" className="relative min-h-0 min-w-0 flex-1 overflow-auto" tabIndex={-1}>
          <div className={cn("mx-auto w-full max-w-[1680px] px-6 py-5 max-sm:px-4", fit && "xl:h-full")}>{children}</div>
        </main>
        <StatusBar />
      </div>
      <CapabilitySync />
      <HistoryRecorder />
    </div>
  );
}
