import { useEffect } from 'react';
import { FolderGit2, Menu, Package, PanelLeftOpen, Wallet } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { AquaLogo } from '@/components/common/AquaLogo';
import { useUiStore } from '@/stores/uiStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useArtifactsStore } from '@/stores/artifactsStore';
import { useUploadStore } from '@/stores/uploadStore';

/**
 * P1 (freemium) — remaining-quota visibility. Users should never discover
 * their balance by hitting a wall mid-thought. Hides itself when billing is
 * unreachable (dev / logged out / older backend) and for unlimited accounts.
 * Amber under 3 messages' worth so the warning lands BEFORE the dead end.
 */
function CreditsChip() {
  const wallet = useWalletStore((s) => s.wallet);
  const refresh = useWalletStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('visibilitychange', onFocus);
    return () => window.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  if (!wallet || wallet.unlimited) return null;
  const low = wallet.total < 15; // chat costs 5 — amber with ~2 messages left

  return (
    <a
      href="/wallet"
      className={
        'tap flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ' +
        (low
          ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15'
          : 'border-border text-foreground-secondary hover:bg-surface-secondary hover:text-foreground')
      }
      title={low ? 'Running low — top up to keep going' : 'Credits remaining'}
      aria-label={`${wallet.total} credits remaining`}
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="tabular-nums">{wallet.total}</span>
    </a>
  );
}

/**
 * What this conversation is grounded in.
 *
 * This lived in the message column as ProjectContextBar — a full-width strip
 * above the thread that pushed the conversation down and was only visible
 * when the dashboard wasn't. Context that comes and goes is worse than no
 * context at all, so it moved into the persistent chrome: always on screen,
 * out of the reading column, one surface instead of two. Renders nothing
 * when the conversation has no project, which is most of them.
 */
function ContextChip() {
  const overview = useUploadStore((s) => s.overview);
  const setShowDashboard = useUploadStore((s) => s.setShowDashboard);

  if (!overview) return null;

  return (
    <button
      onClick={() => setShowDashboard(true)}
      className="tap flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full border border-border px-2.5 text-micro font-medium text-foreground-secondary transition-colors hover:bg-surface-secondary hover:text-foreground"
      title={`Answering with ${overview.name} in context`}
    >
      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">{overview.name}</span>
      <span className="hidden shrink-0 tabular-nums text-foreground-secondary/60 sm:inline">
        {(overview.stats?.fileCount ?? 0).toLocaleString()}
      </span>
    </button>
  );
}

export function Header() {
  const isMobile = useIsMobile();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { pathname } = useLocation();
  const openArtifacts = useArtifactsStore((s) => s.setOpen);
  const items = useConversationStore((s) => s.items);

  const activeId = pathname.startsWith('/c/') ? pathname.slice(3) : null;
  const activeTitle = activeId ? items.find((c) => c.id === activeId)?.title : null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)] md:h-14 md:px-4">
      {isMobile ? (
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="tap flex h-9 w-9 items-center justify-center rounded-lg text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>
      ) : (
        sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="tap flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )
      )}
      {activeTitle ? (
        <span className="truncate text-sm font-medium text-foreground">{activeTitle}</span>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center">
            <AquaLogo size={24} />
          </div>
          {/* The tagline here read "AI Engineering Workspace" — the exact
              category the product is not. Removed rather than reworded: this
              strip is the highest-value persistent real estate in the app,
              and a static noun is the weakest thing it could hold. Phase D
              gives the space to a live context indicator. */}
          <span className="text-sm font-semibold tracking-tight text-foreground">AQUA</span>
        </div>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <ContextChip />
        <CreditsChip />
        <button
          onClick={() => openArtifacts(true)}
          className="tap flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
          aria-label="Open artifacts"
          title="Artifacts"
        >
          <Package className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}