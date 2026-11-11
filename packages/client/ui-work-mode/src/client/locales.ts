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
  'chat.loginPending': '请在打开的窗口中完成登录。',
  'chat.loginCancel': '取消登录',
  'chat.browserLogin': '通过浏览器登录',
  'chat.browserWaiting': '请在打开的浏览器窗口中完成登录。',
  'chat.providerRejected': 'Google 拒绝了内嵌浏览器。请改用浏览器登录。',
  'chat.browserMissing': '未找到受支持的浏览器。请安装 Chrome 或 Edge。',
  'chat.browserTimeout': '浏览器登录超时。',
  'chat.browserFailed': '无法将登录状态传入对话。',
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
  'chat.loginPending': 'Complete the sign-in in the opened window.',
  'chat.loginCancel': 'Cancel sign-in',
  'chat.browserLogin': 'Sign in through a browser',
  'chat.browserWaiting': 'Finish signing in in the opened browser window.',
  'chat.providerRejected': 'Google rejected the embedded browser. Sign in through a browser instead.',
  'chat.browserMissing': 'No supported browser was found. Install Chrome or Edge.',
  'chat.browserTimeout': 'The browser sign-in timed out.',
  'chat.browserFailed': 'Could not transfer the sign-in into the chat.',
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
  'chat.loginPending': 'Завершите вход в открывшемся окне.',
  'chat.loginCancel': 'Отменить вход',
  'chat.browserLogin': 'Войти через браузер',
  'chat.browserWaiting': 'Завершите вход в открывшемся окне браузера.',
  'chat.providerRejected': 'Google отклонил встроенный браузер. Войдите через браузер.',
  'chat.browserMissing': 'Поддерживаемый браузер не найден. Установите Chrome или Edge.',
  'chat.browserTimeout': 'Время ожидания входа в браузере истекло.',
  'chat.browserFailed': 'Не удалось перенести вход в чат.',
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
  'chat.loginPending': '開いたウィンドウでログインを完了してください。',
  'chat.loginCancel': 'ログインをキャンセル',
  'chat.browserLogin': 'ブラウザでログイン',
  'chat.browserWaiting': '開いたブラウザウィンドウでログインを完了してください。',
  'chat.providerRejected': 'Google が内蔵ブラウザを拒否しました。ブラウザでログインしてください。',
  'chat.browserMissing': '対応ブラウザが見つかりません。Chrome または Edge をインストールしてください。',
  'chat.browserTimeout': 'ブラウザでのログインがタイムアウトしました。',
  'chat.browserFailed': 'ログインをチャットへ移せませんでした。',
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
  'chat.loginPending': 'Completa el inicio de sesión en la ventana abierta.',
  'chat.loginCancel': 'Cancelar inicio de sesión',
  'chat.browserLogin': 'Iniciar sesión con el navegador',
  'chat.browserWaiting': 'Completa el inicio de sesión en la ventana del navegador abierta.',
  'chat.providerRejected': 'Google rechazó el navegador integrado. Inicia sesión con el navegador.',
  'chat.browserMissing': 'No se encontró un navegador compatible. Instala Chrome o Edge.',
  'chat.browserTimeout': 'Se agotó el tiempo de inicio de sesión en el navegador.',
  'chat.browserFailed': 'No se pudo transferir el inicio de sesión al chat.',
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
  'chat.loginPending': 'Terminez la connexion dans la fenêtre ouverte.',
  'chat.loginCancel': 'Annuler la connexion',
  'chat.browserLogin': 'Se connecter via le navigateur',
  'chat.browserWaiting': 'Terminez la connexion dans la fenêtre du navigateur ouverte.',
  'chat.providerRejected': 'Google a refusé le navigateur intégré. Connectez-vous via le navigateur.',
  'chat.browserMissing': 'Aucun navigateur compatible trouvé. Installez Chrome ou Edge.',
  'chat.browserTimeout': 'La connexion via le navigateur a expiré.',
  'chat.browserFailed': 'Impossible de transférer la connexion dans le chat.',
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
  'chat.loginPending': 'Schließe die Anmeldung im geöffneten Fenster ab.',
  'chat.loginCancel': 'Anmeldung abbrechen',
  'chat.browserLogin': 'Über den Browser anmelden',
  'chat.browserWaiting': 'Schließe die Anmeldung im geöffneten Browserfenster ab.',
  'chat.providerRejected': 'Google hat den eingebetteten Browser abgelehnt. Melde dich über den Browser an.',
  'chat.browserMissing': 'Kein unterstützter Browser gefunden. Installiere Chrome oder Edge.',
  'chat.browserTimeout': 'Die Browser-Anmeldung ist abgelaufen.',
  'chat.browserFailed': 'Die Anmeldung konnte nicht in den Chat übertragen werden.',
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
  'chat.loginPending': 'Conclua o login na janela aberta.',
  'chat.loginCancel': 'Cancelar login',
  'chat.browserLogin': 'Entrar pelo navegador',
  'chat.browserWaiting': 'Conclua o login na janela do navegador aberta.',
  'chat.providerRejected': 'O Google recusou o navegador incorporado. Entre pelo navegador.',
  'chat.browserMissing': 'Nenhum navegador compatível encontrado. Instale o Chrome ou o Edge.',
  'chat.browserTimeout': 'O login pelo navegador expirou.',
  'chat.browserFailed': 'Não foi possível transferir o login para o chat.',
  'chat.webTitle': 'Chat do DeepSeek',
  'chat.webBody': 'O chat abre em outra aba do navegador: o site não permite incorporação.',
  'chat.webAction': 'Abrir chat.deepseek.com',
} satisfies Record<keyof typeof en, string>

/** Locale namespace these dictionaries register under. */
export const NS = 'workMode'
