/// <reference types="vite/client" />

// Add this declaration:
declare module "*.svg" {
  const content: string; // Tells TS that importing an SVG yields a string (the URL/path)
  export default content;
}

// You can add similar declarations for other asset types if needed:
// declare module '*.png' {
//   const content: string;
//   export default content;
// }
// declare module '*.jpg' {
//   const content: string;
//   export default content;
// }
