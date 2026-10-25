/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_GAMES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
