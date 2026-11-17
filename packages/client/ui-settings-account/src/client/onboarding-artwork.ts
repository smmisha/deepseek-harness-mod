/** Which localized product-screenshot family a first-run page shows. */

/** Artwork families: Chinese screenshots where they exist, the English set otherwise. */
export type OnboardingArtworkLanguage = 'zh' | 'en'

/**
 * Select the screenshot family for the active interface language.
 * @param language - active UI language tag, such as `zh`, `zh-CN`, or `de`.
 * @returns `zh` only for a Chinese primary subtag; every other language shares the
 * English artwork until localized screenshots ship for it.
 */
export function onboardingArtworkLanguage(language: string): OnboardingArtworkLanguage {
  return language.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh' : 'en'
}
