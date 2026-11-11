/**
 * Diagnostic log for the embedded chat's provider sign-in.
 *
 * The packaged build has no attached console, so sign-in decisions are appended
 * to a bounded file under userData. Only host names, states, and error kinds are
 * recorded: never tokens, cookies, query strings, or document contents.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/** Rotate the log once it reaches this size. */
const MAX_BYTES = 512 * 1024

/**
 * Append one sign-in diagnostic line.
 * @param line - token- and cookie-free description of the decision.
 */
export function logChatLogin(line: string): void {
  try {
    const file = join(app.getPath('userData'), 'logs', 'chat-login.log')
    mkdirSync(dirname(file), { recursive: true })
    try {
      if (statSync(file).size >= MAX_BYTES) renameSync(file, `${file}.1`)
    } catch {
      // The file does not exist yet; the append below creates it.
    }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch (error) {
    // Diagnostics are best-effort and must never block the sign-in itself.
    void error
  }
}
