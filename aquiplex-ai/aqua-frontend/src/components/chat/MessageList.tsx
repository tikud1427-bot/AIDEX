import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useChatStore } from '@/stores/chatStore';
import { Skeleton } from '@/components/ui/skeleton';
import type { UiMessage } from '@/types';

function HistorySkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-xl" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-4 w-2/3 max-w-xs" />
        </div>
      </div>
    </div>
  );
}

/**
 * Screen-reader narration for a streaming answer.
 *
 * A live region wrapped around the message text would announce every token
 * burst — unusable. Instead the region holds ONE sentence, published only on
 * the transitions a listener actually needs: the answer started, the answer
 * finished, the answer failed. The text itself is read on demand, the way
 * any other page content is.
 */
function useTurnAnnouncement(last: UiMessage | undefined) {
  const [message, setMessage] = useState('');
  const previous = useRef<string | undefined>(undefined);

  const status = last && last.role === 'assistant' ? last.status : undefined;

  useEffect(() => {
    if (status === previous.current) return;
    previous.current = status;
    if (status === 'sending' || status === 'streaming') setMessage('AQUA is answering.');
    else if (status === 'error') setMessage('AQUA could not answer. Retry is available below the message.');
    else if (status === 'complete') setMessage('Answer complete.');
  }, [status]);

  return message;
}

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const loadingHistory = useChatStore((s) => s.loadingHistory);
  const announcement = useTurnAnnouncement(messages[messages.length - 1]);
  /**
   * Messages present at the first commit are history, not arrivals. They mount
   * without an entrance animation; everything after that animates in. A ref
   * (not state) because this must be known DURING the render that mounts them.
   */
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);

  const { containerRef, pinned, scrollToBottom, handleScroll } = useAutoScroll<HTMLDivElement>([
    messages.length,
    messages[messages.length - 1]?.content,
  ]);

  if (loadingHistory) return <HistorySkeleton />;

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* scroll-behavior kept 'auto': instant scrollTop follow during streaming;
          smooth easing only for the explicit Jump-to-latest button.
          overflow-anchor off — the hook owns anchoring; browser anchoring on
          top of it causes visible jumps when message heights change. */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto [overflow-anchor:none]"
      >
        <div className="mx-auto w-full max-w-3xl py-4">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isLast={i === messages.length - 1}
                animateIn={settled.current}
              />
            ))}
          </AnimatePresence>
          <div className="h-4" />
        </div>
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {!pinned && (
        <button
          onClick={() => scrollToBottom()}
          aria-label="Jump to the latest message"
          className="tap absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-transform hover:scale-105"
        >
          <ArrowDown className="h-3 w-3" /> Jump to latest
        </button>
      )}
    </div>
  );
}
