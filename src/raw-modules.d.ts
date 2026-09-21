// Vite's `?raw` import suffix returns a module's file contents as a string. Used by tests to
// load HTML fixtures without Node's `fs` (which would need @types/node in the tsc program).
declare module '*?raw' {
  const content: string;
  export default content;
}
