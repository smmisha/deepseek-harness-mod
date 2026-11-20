/** Localized browser-tab document shown after a failed web sign-in attempt. */
import type { AccountClientMetadata } from './types.ts'

/** One rendered failure page: the document language and its single sentence. */
export interface FailedCallbackPage {
  /** BCP 47 language tag for the document element. */
  readonly lang: string
  /** Message used as both the tab title and the page body. */
  readonly message: string
}

const ENGLISH: FailedCallbackPage = {
  lang: 'en',
  message: 'Sign-in failed. Close this tab and try again in the original tab.',
}

/**
 * Message per primary language subtag. Auth failures happen after the initiating tab may have
 * gone away, so the return document cannot read the Client dictionaries and owns this copy.
 */
const PAGES: Readonly<Record<string, FailedCallbackPage>> = {
  en: ENGLISH,
  zh: { lang: 'zh-CN', message: '登录失败，请关闭此标签页并在原页面重试。' },
  ja: { lang: 'ja', message: 'ログインできませんでした。このタブを閉じて、元のタブでもう一度お試しください。' },
  es: { lang: 'es', message: 'No se pudo iniciar sesión. Cierra esta pestaña y vuelve a intentarlo en la pestaña original.' },
  fr: { lang: 'fr', message: "La connexion a échoué. Fermez cet onglet et réessayez dans l'onglet d'origine." },
  de: { lang: 'de', message: 'Die Anmeldung ist fehlgeschlagen. Schließen Sie diesen Tab und versuchen Sie es im ursprünglichen Tab erneut.' },
  ru: { lang: 'ru', message: 'Не удалось войти. Закройте эту вкладку и повторите попытку на исходной вкладке.' },
  pt: { lang: 'pt', message: 'Não foi possível entrar. Feche esta aba e tente novamente na aba original.' },
  uk: { lang: 'uk', message: 'Не вдалося увійти. Закрийте цю вкладку й повторіть спробу в початковій вкладці.' },
}

/**
 * Localize the failed sign-in return page for the attempt's UI language.
 * @param locale - UI language sent with the attempt, such as `zh`, `de-DE`, or `pt_BR`.
 * @returns the document language and message; English covers unknown languages.
 */
export function failedCallbackPage(locale: AccountClientMetadata['locale']): FailedCallbackPage {
  const primary = /^[a-z]+/.exec(locale.toLowerCase())?.[0]
  return primary === undefined ? ENGLISH : PAGES[primary] ?? ENGLISH
}
