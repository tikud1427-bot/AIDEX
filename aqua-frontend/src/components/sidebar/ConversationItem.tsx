import { useRef, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { ArchiveRestore, MoreHorizontal, Pin, PinOff, Pencil, Share2, Trash2, MessageSquare } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useConversationStore } from '@/stores/conversationStore';
import { useUiStore } from '@/stores/uiStore';
import { shareConversation } from '@/utils/shareConversation';
import { cn } from '@/lib/utils';
import type { UiConversation } from '@/types';

export function ConversationItem({ conversation, onNavigate }: { conversation: UiConversation; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Escape must not commit, and Enter must not commit twice (committing
  // unmounts the input, which fires a blur that would run the handler again).
  const cancelledRef = useRef(false);
  const committedRef = useRef(false);

  const togglePin = useConversationStore((s) => s.togglePin);
  const toggleArchive = useConversationStore((s) => s.toggleArchive);
  const rename = useConversationStore((s) => s.rename);
  const removeConversation = useConversationStore((s) => s.removeConversation);
  const toast = useUiStore((s) => s.toast);

  // Active state is read here rather than through NavLink's render prop,
  // because the row's link and its menu button are now siblings — both need
  // it, and neither may be nested inside the other.
  const isActive = !!useMatch(`/c/${conversation.id}`);

  function startRename() {
    setDraft(conversation.title);
    cancelledRef.current = false;
    committedRef.current = false;
    setRenaming(true);
  }

  function commitRename() {
    if (committedRef.current) return;
    committedRef.current = true;

    const trimmed = draft.trim();
    const previous = conversation.title;
    setRenaming(false);
    if (!trimmed || trimmed === previous) return;

    rename(conversation.id, trimmed);
    // A rename used to commit silently on blur with no way back. Naming the
    // change and offering the way back makes an accidental blur recoverable.
    toast('success', 'Renamed', undefined, {
      label: 'Undo',
      onClick: () => rename(conversation.id, previous),
    });
  }

  function handleUnarchive() {
    toggleArchive(conversation.id);
    toast('success', 'Moved back to your conversations');
  }

  async function handleShare() {
    // Client-side transcript share: the backend exposes no share endpoint
    // (GET / GET:id / PATCH / DELETE only), so this shares the conversation
    // itself rather than promising a link it cannot mint.
    try {
      const result = await shareConversation(conversation.id, conversation.title);
      if (result === 'copied') {
        toast('success', 'Copied to clipboard', 'Sharing isn\u2019t supported here, so the transcript was copied instead.');
      } else if (result === 'failed') {
        toast('error', 'Could not share this conversation', 'Check your connection and try again.');
      }
      // 'shared' needs no toast — the native sheet already confirmed.
      // 'cancelled' is the user backing out, which is not an error.
    } catch {
      toast('error', 'Could not share this conversation', 'Check your connection and try again.');
    }
  }

  async function handleDelete() {
    try {
      await removeConversation(conversation.id);
    } catch {
      toast('error', 'Could not delete conversation', 'Check your connection and try again.');
    }
  }

  if (renaming) {
    // Edit in place: same height, same icon, same padding as the row it
    // replaces. Swapping the whole row for a bare input made the thread being
    // renamed lose its identity mid-edit.
    return (
      <li className="row-touch flex items-center gap-2 rounded-lg bg-surface-secondary py-1 pl-2.5 pr-1.5">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        <Input
          autoFocus
          value={draft}
          aria-label="Conversation name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            commitRename();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              cancelledRef.current = true;
              setDraft(conversation.title);
              setRenaming(false);
            }
          }}
          className="h-8 flex-1 border-transparent bg-transparent px-1 shadow-none"
        />
      </li>
    );
  }

  return (
    /* The row IS the list item — not a wrapper around one. `display: contents`
       on an <li> is still dropped from the accessibility tree in some engines,
       which would cost the list semantics this change exists to add. The
       ConfirmDialog below portals to <body>, so it costs the row no layout. */
    <li
      className={cn(
        'group/item row-touch relative flex items-center rounded-lg text-sm transition-colors',
        isActive
          ? 'bg-surface-secondary font-medium text-foreground'
          : 'text-foreground-secondary hover:bg-surface-secondary/60 hover:text-foreground',
      )}
    >
      {isActive && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
      )}

      {/* The link and the menu button are SIBLINGS. Nesting a <button>
          inside this <a> was invalid markup, announced ambiguously to
          screen readers, and needed a preventDefault() hack to stop the
          row navigating whenever the menu was opened. */}
      <Link
        to={`/c/${conversation.id}`}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {conversation.pinned && (
          <Pin className="h-3 w-3 shrink-0 fill-current text-primary/70" aria-hidden="true" />
        )}
      </Link>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'tap touch-lg affordance mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              'text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground',
              menuOpen && 'bg-surface text-foreground',
            )}
            aria-label={`Options for ${conversation.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem onSelect={() => togglePin(conversation.id)}>
            {conversation.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {conversation.pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void handleShare()}>
            <Share2 className="h-3.5 w-3.5" /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={startRename}>
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>

          {/* Nothing new can be archived. Rows archived under the previous
              implementation keep their way back, so no thread is stranded. */}
          {conversation.archived && (
            <DropdownMenuItem onSelect={handleUnarchive}>
              <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete conversation?"
        description={`\u201C${conversation.title}\u201D will be permanently deleted. This can\u2019t be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </li>
  );
}
