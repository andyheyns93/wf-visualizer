import type { AdoContext, AdoRef } from './adoContext';

/** Content script → background: fetch the workflow file for this context. */
export interface FetchWorkflowRequest {
  type: 'wf/fetchWorkflow';
  context: AdoContext;
}

export type FetchWorkflowResponse =
  | { ok: true; text: string; path: string; ref?: AdoRef }
  | { ok: false; reason: 'no-token' | 'unauthorized' | 'not-found' | 'error'; status?: number };

/** Background → content script: the ADO app fetched a (possibly new) workflow file. */
export interface WorkflowChangedMessage {
  type: 'wf/workflowChanged';
}

/** Content script → background: fetch the before/after versions of the PR's workflow file. */
export interface FetchPrDiffRequest {
  type: 'wf/fetchPrDiff';
  context: AdoContext;
  /** Path of the file currently open (from the compare toolbar); falls back to the capture. */
  path?: string;
}

export type FetchPrDiffResponse =
  | { ok: true; path: string; before: string | null; after: string | null }
  | { ok: false; reason: 'no-token' | 'unauthorized' | 'not-found' | 'error'; status?: number };

/** Content script → background: open the extension's options page. */
export interface OpenOptionsRequest {
  type: 'wf/openOptions';
}

/** Messages the background worker receives. */
export type ExtMessage = FetchWorkflowRequest | FetchPrDiffRequest | OpenOptionsRequest;

/** Messages the content script receives. */
export type ContentMessage = WorkflowChangedMessage;
