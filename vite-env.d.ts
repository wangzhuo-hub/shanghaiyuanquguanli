/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_POCKETBASE_URL?: string;
    readonly VITE_POCKETBASE_EMAIL?: string;
    readonly VITE_POCKETBASE_PASSWORD?: string;
    readonly VITE_POCKETBASE_PROJECT_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
