import { useEffect, useRef } from 'react';

/**
 * Platform detection.
 *
 * `navigator.platform` is deprecated and, on iPadOS, reports "MacIntel" —
 * which produces the right ⌘ glyph, but by accident. Prefer the User-Agent
 * Client Hints platform where it exists, fall back to the UA string, and only
 * then to the legacy field.
 */
interface UaDataLike {
  platform?: string;
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: UaDataLike }).userAgentData;
  if (uaData?.platform) return /mac/i.test(uaData.platform);
  if (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? '');
}

export const isMac = detectMac();
export const modKey = isMac ? '⌘' : 'Ctrl';

export interface ShortcutDef {
  id: string;
  keys: string[];
  label: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'new-chat', keys: [modKey, 'Shift', 'O'], label: 'New chat' },
  { id: 'focus-search', keys: [modKey, 'K'], label: 'Search conversations' },
  { id: 'toggle-sidebar', keys: [modKey, 'B'], label: 'Toggle sidebar' },
  { id: 'upload-project', keys: [modKey, 'Shift', 'U'], label: 'Upload repository' },
  { id: 'open-settings', keys: [modKey, ','], label: 'Open settings' },
  { id: 'stop-generating', keys: ['Esc'], label: 'Stop generating' },
];

interface Handlers {
  onNewChat: () => void;
  onFocusSearch: () => void;
  onToggleSidebar: () => void;
  onUploadProject: () => void;
  onOpenSettings: () => void;
  onStopGenerating: () => void;
}

export function useKeyboardShortcuts(handlers: Handlers) {
  /**
   * The handler bag is rebuilt on every render of AppShell, so depending on it
   * directly meant removeEventListener + addEventListener on every render —
   * including every frame of a streaming response, because AppShell subscribes
   * to the chat store. A ref keeps the listener registered exactly once for
   * the life of the shell while still calling the current handlers.
   */
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const h = ref.current;

      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        h.onNewChat();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        h.onFocusSearch();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        h.onToggleSidebar();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        h.onUploadProject();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        h.onOpenSettings();
      } else if (e.key === 'Escape' && !inField) {
        h.onStopGenerating();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
