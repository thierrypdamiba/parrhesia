// Vite inlines `?raw` imports as strings (server/migrations.ts). Mirrors vite/client's
// declaration without pulling in the rest of its ambient types.
declare module '*.sql?raw' {
  const src: string;
  export default src;
}
