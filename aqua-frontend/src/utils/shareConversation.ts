import { getConversation } from '@/api/conversations';
import { shareText } from './export';

/**
 * Whole-conversation sharing.
 *
 * The backend exposes no share endpoint — `/conversations` is GET, GET/:id,
 * PATCH, DELETE only — so this shares the conversation's CONTENT through the
 * platform's own share sheet (clipboard where that isn't available) rather
 * than promising a public link the server cannot mint. If real shared links
 * are wanted later, only this module changes; the menu item stays put.
 */
export function formatTranscript(
  title: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  const body = messages
    .map((m) => `${m.role === 'user' ? 'You' : 'AQUA'}:\n${m.content}`)
    .join('\n\n———\n\n');

  return `${title}\n\n${body}\n\nShared from AQUA`;
}

export async function shareConversation(id: string, title: string) {
  const { messages } = await getConversation(id);
  return shareText(formatTranscript(title, messages));
}
