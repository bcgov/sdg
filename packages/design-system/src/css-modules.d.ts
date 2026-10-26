// Vite CSS Modules: each import is a map of local class names to generated ones.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
