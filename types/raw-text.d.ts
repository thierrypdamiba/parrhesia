// Vite inlines `?raw` imports as strings; server/judge.ts loads the shipped seed snapshot
// (seed/2026-17902.txt and .detail.json) this way. Mirrors types/modules.d.ts for .sql.
declare module '*.txt?raw' {
  const src: string;
  export default src;
}
declare module '*.json?raw' {
  const src: string;
  export default src;
}
