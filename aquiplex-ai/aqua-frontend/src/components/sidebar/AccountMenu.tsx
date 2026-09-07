import { ChevronsUpDown, LoaderCircle, LogIn, LogOut, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { LOGIN_PATH } from '@/api/routes';
import { displayNameFromEmail, initialsFromEmail } from '@/lib/identity';
import { useSessionStore, sessionNavigation } from '@/stores/sessionStore';
import { cn } from '@/lib/utils';

/**
 * The signed-in account, and the way out of it.
 *
 * WHY THE NAME IS DERIVED
 * -----------------------
 * The User model has an email and nothing else — no display name, no avatar
 * URL. The platform already turns an email into a name in exactly one way
 * (`username: user.email.split("@")[0]`, index.js), so this follows it rather
 * than inventing a second convention or hard-coding anything. The email is
 * always shown directly beneath, so a derived name can never mislead.
 *
 * The name and initials shown here are derived from the email — see
 * lib/identity.ts for why that is the only source available.
 *
 * ACCESSIBILITY comes from the primitive. @radix-ui/react-dropdown-menu — the
 * one the design system already wraps in ui/dropdown-menu.tsx — gives real
 * button semantics, aria-expanded/aria-haspopup, roving focus through the
 * items, Escape to close, outside-click to close, focus returned to the
 * trigger on close, and collision-aware anchoring. None of that is
 * reimplemented here; reimplementing it is how it gets got wrong.
 */

const rowBase =
  'tap row-touch flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ' +
  'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

export function AccountMenu({ collapsed = false }: { collapsed?: boolean }) {
  const status = useSessionStore((s) => s.status);
  const account = useSessionStore((s) => s.account);
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  const signOut = useSessionStore((s) => s.signOut);

  const busy = phase !== 'idle';

  // ── Loading ────────────────────────────────────────────────────────────────
  // Never a name, never an email, never a guess. Showing the previous account
  // for one frame after a switch is the bug, not a cosmetic imperfection.
  if (status === 'loading') {
    return collapsed ? (
      <Skeleton className="h-8 w-8 rounded-full" data-testid="account-loading" />
    ) : (
      <div className="flex items-center gap-2.5 px-2.5 py-2" data-testid="account-loading">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-2 w-32" />
        </div>
      </div>
    );
  }

  // ── Signed out / expired ───────────────────────────────────────────────────
  // The session died underneath the app. Say so, and offer the way back in.
  if (status === 'unauthenticated' || !account) {
    const goToLogin = () => sessionNavigation.go(LOGIN_PATH);
    return collapsed ? (
      <Tooltip label="Sign in" side="right">
        <button
          onClick={goToLogin}
          aria-label="Sign in"
          className="tap flex h-11 w-11 items-center justify-center rounded-lg text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
        >
          <LogIn className="h-4.5 w-4.5" />
        </button>
      </Tooltip>
    ) : (
      <button onClick={goToLogin} className={rowBase}>
        <LogIn className="h-4 w-4 shrink-0" />
        Sign in
      </button>
    );
  }

  // ── Signed in ──────────────────────────────────────────────────────────────
  const name = displayNameFromEmail(account.email);
  const initials = initialsFromEmail(account.email);

  const trigger = collapsed ? (
    <Tooltip label={name} side="right">
      <button
        aria-label={`Account: ${account.email}`}
        className="tap flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[0.65rem]">{initials}</AvatarFallback>
        </Avatar>
      </button>
    </Tooltip>
  ) : (
    <button
      aria-label={`Account: ${account.email}`}
      className={cn(
        'tap row-touch flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
        'hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'data-[state=open]:bg-surface-secondary',
      )}
    >
      <Avatar className="h-7 w-7">
        <AvatarFallback className="text-[0.65rem]">{initials}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        <span className="block truncate text-micro text-foreground-secondary">{account.email}</span>
      </span>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/60" aria-hidden="true" />
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>

      {/* side="top" so the menu opens INTO the conversation area rather than
          off the bottom of a short viewport; Radix flips it automatically if
          there is no room. align="start" keeps it flush with the rail.
          The width tracks the trigger on the rail and stays readable in the
          collapsed 60px variant, where the trigger is a 44px square. */}
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className={cn('w-[15rem]', !collapsed && 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-[14rem]')}
      >
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-[0.7rem]">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <p className="truncate text-micro text-foreground-secondary">{account.email}</p>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={busy}
          // preventDefault keeps the menu open: the navigation happens in
          // signOut, and if it FAILS the error has to have somewhere to render.
          onSelect={(e) => {
            e.preventDefault();
            void signOut('switch');
          }}
        >
          {phase === 'switching' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Users className="h-4 w-4" aria-hidden="true" />
          )}
          {phase === 'switching' ? 'Switching…' : 'Switch account'}
        </DropdownMenuItem>

        <DropdownMenuItem
          destructive
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault();
            void signOut('logout');
          }}
        >
          {phase === 'signing-out' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden="true" />
          )}
          {phase === 'signing-out' ? 'Signing out…' : 'Log out'}
        </DropdownMenuItem>

        {error && (
          <p role="alert" className="px-2.5 pb-1.5 pt-1 text-micro leading-relaxed text-danger">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
