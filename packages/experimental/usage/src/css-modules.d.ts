/** CSS Modules are typed through this ambient declaration in client packages. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
