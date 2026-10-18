/** Vite's `?raw` imports (used by tests that read source text). */
declare module "*?raw" {
  const content: string;
  export default content;
}
