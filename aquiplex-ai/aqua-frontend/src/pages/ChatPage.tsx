import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MessageList } from '@/components/chat/MessageList';
import { EmptyState } from '@/components/chat/EmptyState';
import { Composer } from '@/components/chat/Composer';
import { WorkspaceDashboard } from '@/components/workspace/WorkspaceDashboard';
import { useChatStore } from '@/stores/chatStore';
import { useUploadStore } from '@/stores/uploadStore';
import { useUnderstandingGate } from '@/hooks/useUnderstandingGate';

export function ChatPage() {
  const { conversationId: routeId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const storeConversationId = useChatStore((s) => s.conversationId);
  const messages = useChatStore((s) => s.messages);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const lastLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (routeId && routeId !== lastLoadedRef.current) {
      lastLoadedRef.current = routeId;
      loadConversation(routeId);
    } else if (!routeId && storeConversationId) {
      // Navigated to "/" (New chat) while a conversation was active.
      lastLoadedRef.current = null;
      newConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  useEffect(() => {
    // First send on "/" just minted a conversationId server-side — reflect
    // it in the URL so refresh, back/forward, and sidebar highlighting all
    // stay in sync with what's actually loaded.
    if (!routeId && storeConversationId) {
      lastLoadedRef.current = storeConversationId;
      navigate(`/c/${storeConversationId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeConversationId]);

  const showEmptyState = !routeId && messages.length === 0;

  // Workspace dashboard becomes the landing page after an upload: shown
  // whenever an overview exists, the user hasn't dismissed it, and no
  // conversation is on screen yet. First message (or clicking a suggested
  // question) hands the screen back to the message list.
  const overview = useUploadStore((s) => s.overview);
  const showDashboard = useUploadStore((s) => s.showDashboard);
  const dashboardVisible = showDashboard && !!overview && messages.length === 0;

  /* ── The first-run gate ──────────────────────────────────────────────────
     UUS built this and then nothing ever asked it. The hook, the route and
     the intro screen all shipped; no component called them, so a brand-new
     account went straight to the project empty state and was never offered
     the introduction — the product's defining first experience was reachable
     only by typing the URL.

     It belongs HERE and nowhere else. This is the one component that owns
     "the user has arrived and there is nothing on screen yet", which is
     exactly the condition the gate answers. Putting it in AppShell would ask
     on every route including the intro itself; putting it in EmptyState would
     make the wrong screen responsible for deciding it should not be the
     screen.

     Scoped hard to the blank index route. An open conversation is never
     interrupted, and a workspace dashboard someone just uploaded into is
     never yanked away — if they are already working, the moment for an
     introduction has passed.                                              */
  const atNewChat = !routeId && messages.length === 0 && !dashboardVisible;
  const gate = useUnderstandingGate(routeId ?? null);

  if (atNewChat && gate.shouldOffer) return <Navigate to="/understanding/start" replace />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dashboardVisible ? (
        <WorkspaceDashboard overview={overview} />
      ) : showEmptyState ? (
        // Held back until the gate answers. Rendering "What are you working
        // on?" and then replacing it a beat later is worse than a short quiet
        // moment: the first thing a new account would see is the product
        // changing its mind. The composer stays mounted throughout, so the
        // screen is never blank and never jumps.
        gate.checked ? <EmptyState /> : null
      ) : (
        <MessageList />
      )}
      <Composer />
    </div>
  );
}
