/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "true" by `npm run dev:sample` (via .env.sample) to show the sample workflows. */
  readonly VITE_SAMPLES?: string;
}
