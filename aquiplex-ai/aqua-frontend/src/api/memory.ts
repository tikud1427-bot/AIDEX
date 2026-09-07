import { apiClient } from './client';
import type { ListFactsResponse, ListMemoryResponse, MemoryFact, MemoryTimelineResponse } from '@/types';

/* ──────────────────────────────────────────────────────────────────────────
   Owner-scoped memory.

   Memory has been owner-scoped server-side since the unified owner model
   (`user:<id>` / `conv:<id>`) — a fact belongs to the person, not to the
   thread it was mentioned in. The frontend only ever called the legacy
   conversation-keyed pair below, which is why Settings could only show you
   whatever the CURRENT conversation happened to surface. These are the
   endpoints that were already there.
   ────────────────────────────────────────────────────────────────────────── */

export async function listMemory() {
  const { data } = await apiClient.get<ListMemoryResponse>('/memory');
  return data;
}

export async function memoryTimeline(days = 30, limit = 12) {
  const { data } = await apiClient.get<MemoryTimelineResponse>('/memory/timeline', {
    params: { days, limit },
  });
  return data;
}

export async function forgetMemoryFact(key: string) {
  const { data } = await apiClient.delete<{ success: true; ownerId: string; deleted: string }>(
    `/memory/fact/${encodeURIComponent(key)}`,
  );
  return data;
}

export async function forgetAllMemory() {
  const { data } = await apiClient.delete<{ success: true; ownerId: string; cleared: true }>('/memory');
  return data;
}

export async function pinMemoryFact(key: string, pinned: boolean) {
  const { data } = await apiClient.post<{ success: boolean; ownerId: string; fact?: MemoryFact }>(
    `/memory/fact/${encodeURIComponent(key)}/pin`,
    { pinned },
  );
  return data;
}

/* ── Legacy conversation-keyed API ────────────────────────────────────────
   Kept because the backend still serves it (it resolves the conversation to
   its owner and returns owner-scoped data anyway). Nothing new should use it. */

export async function listFacts(conversationId: string) {
  const { data } = await apiClient.get<ListFactsResponse>(`/memory/${encodeURIComponent(conversationId)}`);
  return data;
}

export async function deleteFact(conversationId: string, key: string) {
  const { data } = await apiClient.delete<{ success: true; deleted: string }>(
    `/memory/${encodeURIComponent(conversationId)}/${encodeURIComponent(key)}`,
  );
  return data;
}

export async function clearFacts(conversationId: string) {
  const { data } = await apiClient.delete<{ success: true; cleared: true }>(
    `/memory/${encodeURIComponent(conversationId)}`,
  );
  return data;
}
