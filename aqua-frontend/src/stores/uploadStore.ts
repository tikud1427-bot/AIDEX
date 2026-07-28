import { create } from 'zustand';
import { createWorkspace, uploadWorkspaceFiles, uploadWorkspaceZip, getWorkspaceOverview } from '@/api/project';
import { normalizeError } from '@/api/client';
import { useChatStore } from './chatStore';
import type { WorkspaceOverview } from '@/types';

export type WorkspaceUploadStatus = 'idle' | 'creating' | 'uploading' | 'indexing' | 'ready' | 'error';

interface UploadState {
  status: WorkspaceUploadStatus;
  progress: number;
  workspaceId: string | null;
  projectName: string | null;
  fileCount: number;
  error: string | null;

  /** Workspace intelligence — generated server-side at index time. */
  overview: WorkspaceOverview | null;
  overviewLoading: boolean;
  /** Which workspace the in-flight overview fetch is for — stale-response guard. */
  pendingWorkspaceId: string | null;
  /** Dashboard visibility — true right after an upload; user can dismiss. */
  showDashboard: boolean;

  uploadProject: (name: string, files: Array<{ path: string; content: string }>) => Promise<void>;
  uploadProjectZip: (name: string, zipBase64: string) => Promise<void>;
  fetchOverview: (workspaceId: string) => Promise<void>;
  /** Drop the visible project context — the active conversation has no workspace. */
  clearOverview: () => void;
  setShowDashboard: (show: boolean) => void;
  reset: () => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  status: 'idle',
  progress: 0,
  workspaceId: null,
  projectName: null,
  fileCount: 0,
  error: null,
  overview: null,
  overviewLoading: false,
  pendingWorkspaceId: null,
  showDashboard: false,

  uploadProject: async (name, files) => {
    // pendingWorkspaceId: null invalidates any in-flight fetchOverview so a
    // late response for the previous workspace cannot overwrite this upload.
    set({ status: 'creating', progress: 0, error: null, projectName: name, overview: null, showDashboard: false, pendingWorkspaceId: null });
    try {
      const ws = await createWorkspace(name);
      set({ status: 'uploading', workspaceId: ws.workspace.id });

      const result = await uploadWorkspaceFiles(ws.workspace.id, files, (pct) => set({ progress: pct }));

      // Overview arrives with the upload response — no extra round trip.
      set({
        status: 'ready', fileCount: result.filesIngested, progress: 100,
        overview: result.overview ?? null, showDashboard: !!result.overview,
      });
      // Attach this workspace to the active conversation so the next chat
      // turn gets relevant file context injected server-side.
      useChatStore.getState().setWorkspaceId(ws.workspace.id);
    } catch (err) {
      set({ status: 'error', error: normalizeError(err).message });
    }
  },

  uploadProjectZip: async (name, zipBase64) => {
    // pendingWorkspaceId: null invalidates any in-flight fetchOverview so a
    // late response for the previous workspace cannot overwrite this upload.
    set({ status: 'creating', progress: 0, error: null, projectName: name, overview: null, showDashboard: false, pendingWorkspaceId: null });
    try {
      const ws = await createWorkspace(name);
      set({ status: 'uploading', workspaceId: ws.workspace.id });

      const result = await uploadWorkspaceZip(ws.workspace.id, zipBase64, (pct) => set({ progress: pct }));

      set({
        status: 'ready', fileCount: result.filesIngested, progress: 100,
        overview: result.overview ?? null, showDashboard: !!result.overview,
      });
      useChatStore.getState().setWorkspaceId(ws.workspace.id);
    } catch (err) {
      set({ status: 'error', error: normalizeError(err).message });
    }
  },

  /**
   * Load the cached overview for a workspace — used when opening a
   * conversation that is grounded in one.
   *
   * Tracks WHICH workspace is in flight rather than merely that one is: a
   * plain in-flight boolean dropped the second request when the user switched
   * conversations quickly, leaving the previous project on screen. Late
   * responses for a workspace that is no longer active are discarded.
   *
   * Does not raise the dashboard. The dashboard is the post-upload landing
   * moment; restoring context should restore the context strip, not reopen a
   * full-screen takeover the user already dismissed.
   */
  fetchOverview: async (workspaceId) => {
    // Switching to a DIFFERENT workspace drops the old view immediately rather
    // than leaving another project's context on screen until the fetch lands.
    // Re-opening the same one keeps it, so there's no flicker.
    const switching = get().workspaceId !== workspaceId;
    set({
      overviewLoading: true,
      pendingWorkspaceId: workspaceId,
      ...(switching ? { overview: null, showDashboard: false } : {}),
    });
    try {
      const res = await getWorkspaceOverview(workspaceId);
      if (get().pendingWorkspaceId !== workspaceId) return; // superseded
      set({
        workspaceId,
        overview: res.overview ?? null,
        showDashboard: false,
        overviewLoading: false,
        pendingWorkspaceId: null,
      });
    } catch {
      // Non-fatal: the context strip just won't render. Chat still works.
      if (get().pendingWorkspaceId !== workspaceId) return;
      set({ overviewLoading: false, pendingWorkspaceId: null });
    }
  },

  clearOverview: () =>
    set({
      overview: null,
      showDashboard: false,
      overviewLoading: false,
      // Cancels any in-flight fetch's right to write (see fetchOverview).
      pendingWorkspaceId: null,
    }),

  setShowDashboard: (show) => set({ showDashboard: show }),

  reset: () => set({
    status: 'idle', progress: 0, workspaceId: null, projectName: null,
    fileCount: 0, error: null,
    // Deliberately keep overview + showDashboard: reset() fires when the
    // upload dialog closes, which is exactly the moment the dashboard
    // should be visible behind it.
  }),
}));