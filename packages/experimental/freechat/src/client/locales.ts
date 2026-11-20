/** Copy for the free web chat page on the Plugins page. */

/** Locale keys the page renders. */
export type FreeChatLocaleKey =
  | 'title' | 'summary'
  | 'models' | 'threads' | 'empty'
  | 'live' | 'idle' | 'generation' | 'turns' | 'updated'
  | 'refresh' | 'reset' | 'resetting' | 'failed' | 'loading'
  | 'threadHint'

/** English copy. */
export const en: Record<FreeChatLocaleKey, string> = {
  title: 'Free web chat',
  summary: 'The local proxy that drives the signed-in web chat, the routes it serves, and the web-session generation of every thread.',
  models: 'Routes',
  threads: 'Threads',
  empty: 'No thread has committed a turn yet.',
  live: 'live',
  idle: 'idle',
  generation: 'generation',
  turns: 'turns',
  updated: 'updated',
  refresh: 'Refresh',
  reset: 'Reset web session',
  resetting: 'Resetting…',
  failed: 'Could not read the bridge: {message}',
  loading: 'Reading the bridge…',
  threadHint: 'Resetting drops the live web conversation; the next turn restores the thread from local memory.',
}

/** Chinese copy. */
export const zh: Record<FreeChatLocaleKey, string> = {
  title: '免费网页聊天',
  summary: '驱动已登录网页聊天的本地代理、它提供的路由，以及每个会话的网页会话代次。',
  models: '路由',
  threads: '会话',
  empty: '还没有会话完成过一轮。',
  live: '活跃',
  idle: '空闲',
  generation: '代次',
  turns: '轮次',
  updated: '更新于',
  refresh: '刷新',
  reset: '重置网页会话',
  resetting: '重置中…',
  failed: '无法读取桥接：{message}',
  loading: '正在读取桥接…',
  threadHint: '重置会关闭当前网页会话；下一轮会从本地记忆恢复会话。',
}

/** Russian copy. */
export const ru: Record<FreeChatLocaleKey, string> = {
  title: 'Бесплатный веб-чат',
  summary: 'Локальный прокси к веб-чату под вашей учётной записью: маршруты, которые он отдаёт, и поколение веб-сессии каждого треда.',
  models: 'Маршруты',
  threads: 'Треды',
  empty: 'Пока ни один тред не завершил ход.',
  live: 'активна',
  idle: 'свободна',
  generation: 'поколение',
  turns: 'ходов',
  updated: 'обновлён',
  refresh: 'Обновить',
  reset: 'Сбросить веб-сессию',
  resetting: 'Сбрасываю…',
  failed: 'Не удалось прочитать мост: {message}',
  loading: 'Читаю мост…',
  threadHint: 'Сброс закрывает живую веб-сессию; следующий ход восстановит тред из локальной памяти.',
}

/** Japanese copy. */
export const ja: Record<FreeChatLocaleKey, string> = {
  title: '無料ウェブチャット',
  summary: 'サインイン済みのウェブチャットを動かすローカルプロキシ、提供するルート、各スレッドのウェブセッション世代を表示します。',
  models: 'ルート',
  threads: 'スレッド',
  empty: 'まだターンを完了したスレッドはありません。',
  live: '稼働中',
  idle: '待機中',
  generation: '世代',
  turns: 'ターン',
  updated: '更新',
  refresh: '再読み込み',
  reset: 'ウェブセッションをリセット',
  resetting: 'リセット中…',
  failed: 'ブリッジを読み取れませんでした: {message}',
  loading: 'ブリッジを読み取っています…',
  threadHint: 'リセットすると現在のウェブ会話が閉じます。次のターンでローカルの記憶からスレッドを復元します。',
}

/** Spanish copy. */
export const es: Record<FreeChatLocaleKey, string> = {
  title: 'Chat web gratuito',
  summary: 'El proxy local que maneja el chat web con sesión iniciada, las rutas que ofrece y la generación de la sesión web de cada hilo.',
  models: 'Rutas',
  threads: 'Hilos',
  empty: 'Ningún hilo ha completado un turno todavía.',
  live: 'activa',
  idle: 'inactiva',
  generation: 'generación',
  turns: 'turnos',
  updated: 'actualizado',
  refresh: 'Actualizar',
  reset: 'Restablecer sesión web',
  resetting: 'Restableciendo…',
  failed: 'No se pudo leer el puente: {message}',
  loading: 'Leyendo el puente…',
  threadHint: 'Restablecer cierra la conversación web activa; el siguiente turno restaura el hilo desde la memoria local.',
}

/** French copy. */
export const fr: Record<FreeChatLocaleKey, string> = {
  title: 'Chat web gratuit',
  summary: 'Le proxy local qui pilote le chat web connecté, les routes qu’il sert et la génération de session web de chaque fil.',
  models: 'Routes',
  threads: 'Fils',
  empty: 'Aucun fil n’a encore terminé de tour.',
  live: 'active',
  idle: 'inactive',
  generation: 'génération',
  turns: 'tours',
  updated: 'mis à jour',
  refresh: 'Actualiser',
  reset: 'Réinitialiser la session web',
  resetting: 'Réinitialisation…',
  failed: 'Impossible de lire la passerelle : {message}',
  loading: 'Lecture de la passerelle…',
  threadHint: 'La réinitialisation ferme la conversation web active ; le tour suivant restaure le fil depuis la mémoire locale.',
}

/** German copy. */
export const de: Record<FreeChatLocaleKey, string> = {
  title: 'Kostenloser Web-Chat',
  summary: 'Der lokale Proxy, der den angemeldeten Web-Chat steuert, die Routen, die er bereitstellt, und die Web-Sitzungsgeneration jedes Threads.',
  models: 'Routen',
  threads: 'Threads',
  empty: 'Noch hat kein Thread einen Zug abgeschlossen.',
  live: 'aktiv',
  idle: 'frei',
  generation: 'Generation',
  turns: 'Züge',
  updated: 'aktualisiert',
  refresh: 'Aktualisieren',
  reset: 'Web-Sitzung zurücksetzen',
  resetting: 'Wird zurückgesetzt…',
  failed: 'Die Brücke konnte nicht gelesen werden: {message}',
  loading: 'Brücke wird gelesen…',
  threadHint: 'Zurücksetzen schließt die laufende Web-Unterhaltung; der nächste Zug stellt den Thread aus dem lokalen Gedächtnis wieder her.',
}

/** Portuguese copy. */
export const pt: Record<FreeChatLocaleKey, string> = {
  title: 'Chat web gratuito',
  summary: 'O proxy local que controla o chat web com sessão iniciada, as rotas que ele serve e a geração da sessão web de cada conversa.',
  models: 'Rotas',
  threads: 'Conversas',
  empty: 'Nenhuma conversa concluiu um turno ainda.',
  live: 'ativa',
  idle: 'livre',
  generation: 'geração',
  turns: 'turnos',
  updated: 'atualizado',
  refresh: 'Atualizar',
  reset: 'Redefinir sessão web',
  resetting: 'Redefinindo…',
  failed: 'Não foi possível ler a ponte: {message}',
  loading: 'Lendo a ponte…',
  threadHint: 'Redefinir fecha a conversa web ativa; o próximo turno restaura a conversa a partir da memória local.',
}
