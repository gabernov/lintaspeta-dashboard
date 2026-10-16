import { useSyncExternalStore } from "react";

/*
 * Bridge for editor chrome that must render outside the editor's own subtree:
 * on phones the status summary lives in the sidebar drawer and the Publish
 * button lives inside the search pill, while both are owned by DatasetEditor.
 * DatasetEditor publishes a snapshot here (including stable handler wrappers
 * that read its latest callbacks through a ref), and AppShell subscribes — so
 * this snapshot only changes when a displayed value or the actions change.
 */

export type EditorChromeActions = {
  toggleWindow: () => void;
  toggleAutoPublish: () => void;
  publish: () => void;
};

export type EditorChrome = {
  mounted: boolean;
  onlineCount: number;
  editOpen: boolean;
  canToggleWindow: boolean;
  autoPublishLabel: string | null;
  autoPublishActive: boolean;
  publishDisabled: boolean;
  publishTitle: string;
  publishBusy: boolean;
  actions: EditorChromeActions;
};

const NOOP: EditorChromeActions = {
  toggleWindow: () => {},
  toggleAutoPublish: () => {},
  publish: () => {},
};

const EMPTY: EditorChrome = {
  mounted: false,
  onlineCount: 0,
  editOpen: false,
  canToggleWindow: false,
  autoPublishLabel: null,
  autoPublishActive: false,
  publishDisabled: false,
  publishTitle: "",
  publishBusy: false,
  actions: NOOP,
};

let snapshot: EditorChrome = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setEditorChrome(next: Partial<EditorChrome>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

export function resetEditorChrome() {
  snapshot = EMPTY;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditorChrome(): EditorChrome {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
