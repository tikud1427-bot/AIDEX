import { FilePlus2, MessagesSquare, RotateCcw, SearchX, WifiOff } from 'lucide-react';

/**
 * Sidebar empty states.
 *
 * One line of grey text used to cover three different situations, and the
 * worst of them was silently wrong: when the list request FAILED, the sidebar
 * still said "No conversations yet" — telling someone they have nothing when
 * we never managed to look.
 *
 * Each state now says what is true, and offers the next move.
 */

function Shell({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-3 py-8 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary text-foreground-secondary/70">
        {icon}
      </div>
      {children}
    </div>
  );
}

/** First run — teach what this column will hold, and how to fill it. */
export function NoConversations() {
  return (
    <Shell icon={<MessagesSquare className="h-4 w-4" />}>
      <p className="text-[13px] font-medium text-foreground">Your conversations live here</p>
      <p className="text-[11.5px] leading-relaxed text-foreground-secondary/80">
        AQUA keeps the context from each one — the files you share, the decisions you make,
        what it learns about how you work.
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-left text-[11px] leading-relaxed text-foreground-secondary/60">
        <FilePlus2 className="mt-px h-3 w-3 shrink-0" />
        Drop a document, image, or repository straight into the chat to start with context.
      </p>
    </Shell>
  );
}

/**
 * No match. Names the limit honestly: search reads titles today, so a user
 * whose words are only in the message body should know the conversation is
 * still there — not conclude AQUA lost it.
 */
export function NoSearchMatch({ query, onClear }: { query: string; onClear: () => void }) {
  const shown = query.length > 24 ? `${query.slice(0, 24)}…` : query;
  return (
    <Shell icon={<SearchX className="h-4 w-4" />}>
      <p className="text-[13px] font-medium text-foreground">No titles match “{shown}”</p>
      <p className="text-[11.5px] leading-relaxed text-foreground-secondary/80">
        Search looks at conversation titles for now.
      </p>
      <button
        onClick={onClear}
        className="tap mt-0.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-surface-secondary"
      >
        Clear search
      </button>
    </Shell>
  );
}

/** The request failed. Never present a failure as an absence. */
export function LoadFailed({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <Shell icon={<WifiOff className="h-4 w-4" />}>
      <p className="text-[13px] font-medium text-foreground">Couldn’t load your conversations</p>
      <p className="text-[11.5px] leading-relaxed text-foreground-secondary/80">
        {message ?? 'Check your connection and try again.'}
      </p>
      <button
        onClick={onRetry}
        className="tap mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-surface-secondary"
      >
        <RotateCcw className="h-3 w-3" /> Try again
      </button>
    </Shell>
  );
}