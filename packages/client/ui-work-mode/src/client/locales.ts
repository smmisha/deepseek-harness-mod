/** `workMode` namespace dictionaries: the Chat/Harness switch and its guest states. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  'mode.label': '工作模式',
  'mode.chat': '对话',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'DeepSeek 对话',
  'chat.errorTitle': '无法打开对话',
  'chat.errorBody': '请检查网络连接，然后重试。',
  'chat.retry': '重试',
  'chat.openInBrowser': '在浏览器中打开',
  'chat.providerRejectedTitle': '该提供方不允许在内嵌浏览器中登录',
  'chat.providerRejectedBody': '请使用邮箱和密码登录。如果账号是通过 Google 或 Apple 创建的，请在登录页用“忘记密码？”设置密码。',
  'chat.providerRejectedReturn': '返回登录',
  'chat.openChatInBrowser': '在浏览器中打开对话',
  'chat.webTitle': 'DeepSeek 对话',
  'chat.webBody': '对话在单独的浏览器标签页中打开：站点禁止被嵌入。',
  'chat.webAction': '打开 chat.deepseek.com',
} satisfies Record<string, string>

/** Dictionary key set shared by every `workMode` namespace translation. */
export type WorkModeKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  'mode.label': 'Working mode',
  'mode.chat': 'Chat',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'DeepSeek chat',
  'chat.errorTitle': 'Could not open the chat',
  'chat.errorBody': 'Check the network connection, then try again.',
  'chat.retry': 'Retry',
  'chat.openInBrowser': 'Open in browser',
  'chat.providerRejectedTitle': 'The provider does not allow sign-in in the embedded browser',
  'chat.providerRejectedBody': 'Sign in with your email and password. If the account was created with Google or Apple, set a password with “Forgot password?” on the sign-in page.',
  'chat.providerRejectedReturn': 'Back to sign-in',
  'chat.openChatInBrowser': 'Open chat in browser',
  'chat.webTitle': 'DeepSeek chat',
  'chat.webBody': 'The chat opens in a separate browser tab: the site refuses to be embedded.',
  'chat.webAction': 'Open chat.deepseek.com',
} satisfies Record<WorkModeKey, string>

/** Russian dictionary checked against the English key set. */
export const ru = {
  'mode.label': 'Режим работы',
  'mode.chat': 'Чат',
  'mode.harness': 'Харнесс',
  'chat.frameLabel': 'Чат DeepSeek',
  'chat.errorTitle': 'Не удалось открыть чат',
  'chat.errorBody': 'Проверьте подключение к сети и попробуйте снова.',
  'chat.retry': 'Повторить',
  'chat.openInBrowser': 'Открыть в браузере',
  'chat.providerRejectedTitle': 'Провайдер не разрешает вход во встроенном браузере',
  'chat.providerRejectedBody': 'Войдите по почте и паролю. Если аккаунт создан через Google или Apple, задайте пароль через «Забыли пароль?» на странице входа.',
  'chat.providerRejectedReturn': 'Вернуться к входу',
  'chat.openChatInBrowser': 'Открыть чат в браузере',
  'chat.webTitle': 'Чат DeepSeek',
  'chat.webBody': 'Чат открывается в отдельной вкладке браузера: сайт запрещает встраивание.',
  'chat.webAction': 'Открыть chat.deepseek.com',
} satisfies Record<keyof typeof en, string>

/** Japanese dictionary checked against the English key set. */
export const ja = {
  'mode.label': '作業モード',
  'mode.chat': 'チャット',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'DeepSeek チャット',
  'chat.errorTitle': 'チャットを開けませんでした',
  'chat.errorBody': 'ネットワーク接続を確認して、もう一度お試しください。',
  'chat.retry': '再試行',
  'chat.openInBrowser': 'ブラウザで開く',
  'chat.providerRejectedTitle': 'このプロバイダーは内蔵ブラウザでのログインを許可していません',
  'chat.providerRejectedBody': 'メールアドレスとパスワードでログインしてください。Google または Apple で作成したアカウントは、ログインページの「パスワードをお忘れですか？」からパスワードを設定してください。',
  'chat.providerRejectedReturn': 'ログインに戻る',
  'chat.openChatInBrowser': 'ブラウザでチャットを開く',
  'chat.webTitle': 'DeepSeek チャット',
  'chat.webBody': 'チャットは別のブラウザタブで開きます。サイトは埋め込みを許可していません。',
  'chat.webAction': 'chat.deepseek.com を開く',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary checked against the English key set. */
export const es = {
  'mode.label': 'Modo de trabajo',
  'mode.chat': 'Chat',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'Chat de DeepSeek',
  'chat.errorTitle': 'No se pudo abrir el chat',
  'chat.errorBody': 'Comprueba la conexión de red y vuelve a intentarlo.',
  'chat.retry': 'Reintentar',
  'chat.openInBrowser': 'Abrir en el navegador',
  'chat.providerRejectedTitle': 'El proveedor no permite iniciar sesión en el navegador integrado',
  'chat.providerRejectedBody': 'Inicia sesión con tu correo y contraseña. Si la cuenta se creó con Google o Apple, establece una contraseña con «¿Has olvidado la contraseña?» en la página de inicio de sesión.',
  'chat.providerRejectedReturn': 'Volver al inicio de sesión',
  'chat.openChatInBrowser': 'Abrir el chat en el navegador',
  'chat.webTitle': 'Chat de DeepSeek',
  'chat.webBody': 'El chat se abre en otra pestaña del navegador: el sitio no permite la inserción.',
  'chat.webAction': 'Abrir chat.deepseek.com',
} satisfies Record<keyof typeof en, string>

/** French dictionary checked against the English key set. */
export const fr = {
  'mode.label': 'Mode de travail',
  'mode.chat': 'Chat',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'Chat DeepSeek',
  'chat.errorTitle': 'Impossible d’ouvrir le chat',
  'chat.errorBody': 'Vérifiez la connexion réseau, puis réessayez.',
  'chat.retry': 'Réessayer',
  'chat.openInBrowser': 'Ouvrir dans le navigateur',
  'chat.providerRejectedTitle': 'Le fournisseur n’autorise pas la connexion dans le navigateur intégré',
  'chat.providerRejectedBody': 'Connectez-vous avec votre adresse e-mail et votre mot de passe. Si le compte a été créé avec Google ou Apple, définissez un mot de passe avec « Mot de passe oublié ? » sur la page de connexion.',
  'chat.providerRejectedReturn': 'Revenir à la connexion',
  'chat.openChatInBrowser': 'Ouvrir le chat dans le navigateur',
  'chat.webTitle': 'Chat DeepSeek',
  'chat.webBody': 'Le chat s’ouvre dans un onglet du navigateur : le site refuse d’être intégré.',
  'chat.webAction': 'Ouvrir chat.deepseek.com',
} satisfies Record<keyof typeof en, string>

/** German dictionary checked against the English key set. */
export const de = {
  'mode.label': 'Arbeitsmodus',
  'mode.chat': 'Chat',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'DeepSeek-Chat',
  'chat.errorTitle': 'Chat konnte nicht geöffnet werden',
  'chat.errorBody': 'Prüfe die Netzwerkverbindung und versuche es erneut.',
  'chat.retry': 'Erneut versuchen',
  'chat.openInBrowser': 'Im Browser öffnen',
  'chat.providerRejectedTitle': 'Der Anbieter erlaubt keine Anmeldung im eingebetteten Browser',
  'chat.providerRejectedBody': 'Melde dich mit E-Mail-Adresse und Passwort an. Wurde das Konto über Google oder Apple erstellt, lege auf der Anmeldeseite über „Passwort vergessen?“ ein Passwort fest.',
  'chat.providerRejectedReturn': 'Zurück zur Anmeldung',
  'chat.openChatInBrowser': 'Chat im Browser öffnen',
  'chat.webTitle': 'DeepSeek-Chat',
  'chat.webBody': 'Der Chat öffnet sich in einem eigenen Browser-Tab: die Seite erlaubt keine Einbettung.',
  'chat.webAction': 'chat.deepseek.com öffnen',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary checked against the English key set. */
export const pt = {
  'mode.label': 'Modo de trabalho',
  'mode.chat': 'Chat',
  'mode.harness': 'Harness',
  'chat.frameLabel': 'Chat do DeepSeek',
  'chat.errorTitle': 'Não foi possível abrir o chat',
  'chat.errorBody': 'Verifique a conexão de rede e tente novamente.',
  'chat.retry': 'Tentar novamente',
  'chat.openInBrowser': 'Abrir no navegador',
  'chat.providerRejectedTitle': 'O provedor não permite entrar no navegador incorporado',
  'chat.providerRejectedBody': 'Entre com e-mail e senha. Se a conta foi criada com Google ou Apple, defina uma senha em “Esqueceu a senha?” na página de entrada.',
  'chat.providerRejectedReturn': 'Voltar à entrada',
  'chat.openChatInBrowser': 'Abrir o chat no navegador',
  'chat.webTitle': 'Chat do DeepSeek',
  'chat.webBody': 'O chat abre em outra aba do navegador: o site não permite incorporação.',
  'chat.webAction': 'Abrir chat.deepseek.com',
} satisfies Record<keyof typeof en, string>

/** Locale namespace these dictionaries register under. */
export const NS = 'workMode'
