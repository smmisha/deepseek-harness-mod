/** Shared reduced-motion check for scripted animation. */

/**
 * Whether scripted motion should be reduced: the system asks for reduced
 * motion, or the Interface motion setting is `reduced` or `none` (the root
 * `data-dsh-motion` attribute). CSS motion follows the same attribute through
 * the theme's motion stylesheet.
 * @returns true when animations should be skipped or shortened.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-dsh-motion')) return true
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
