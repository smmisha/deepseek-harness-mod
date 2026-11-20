/**
 * Electron guest transport. The desktop shell already embeds the signed-in chat
 * site in a `<webview>`; this driver types into that page's composer through a
 * {@link GuestPort} and streams the answer by polling the rendered message.
 *
 * The page is driven, never inspected for credentials: no cookie, token, or
 * storage entry is read, and the prompt never becomes a request header.
 */

import type { GuestPort, WebChatSession, WebChatTransport } from '../types.ts'

/** DOM landmarks the driver depends on; a site change is calibrated here only. */
export interface GuestSelectors {
  /** Composer input selector. */
  readonly composer: string
  /** Send control selector, resolved inside the composer's form when possible. */
  readonly sendButton: string
  /** Control present only while the answer is still streaming. */
  readonly stopButton: string
  /** Rendered assistant message selector; the last match is read. */
  readonly assistantMessage: string
  /** Control that starts a new conversation. */
  readonly newChatButton: string
}

/**
 * Defaults for the chat site. They are configuration, not compile-time
 * knowledge: a renamed control is fixed by changing the mounted config.
 */
/** Default budget for one web-chat answer; long enough for reasoning, short enough to fail visibly. */
export const DEFAULT_ANSWER_TIMEOUT_MS = 180_000

export const DEFAULT_GUEST_SELECTORS: GuestSelectors = {
  composer: 'textarea[name="search"], textarea, [contenteditable="true"]',
  sendButton: '[role="button"][class*="ds-button--primary"], button[type="submit"], button[aria-label*="Send"]',
  stopButton: '[class*="ds-loading"], button[aria-label*="Stop"], button[aria-label*="停止"]',
  assistantMessage: '.ds-assistant-message-main-content, [class*="markdown"], [data-message-author-role="assistant"]',
  newChatButton: '[class*="_5a8ac7a"], a[href="/"], button[aria-label*="New chat"]',
}

/** Runtime settings the driver needs beside the selectors. */
export interface GuestTransportOptions {
  /** Port that evaluates scripts inside the guest page. */
  readonly port: GuestPort
  /** DOM landmarks. */
  readonly selectors?: GuestSelectors
  /** Poll interval while an answer streams. */
  readonly pollMs: number
  /** Consecutive idle polls required before an answer is considered complete. */
  readonly idlePolls: number
  /** Budget for the composer to appear after a navigation. */
  readonly readyTimeoutMs: number
  /** Budget for one answer to finish; a stalled page fails instead of polling forever. */
  readonly answerTimeoutMs: number
}

/** Snapshot one poll reads from the guest page. */
interface GuestSnapshot {
  readonly streaming: boolean
  readonly text: string
  /** Number of rendered assistant nodes; a new answer raises it. */
  readonly count: number
}

/** Build the script that fills the composer and submits it. */
function composeScript(prompt: string, selectors: GuestSelectors): string {
  return `(() => {
  const composer = document.querySelector(${JSON.stringify(selectors.composer)});
  if (!composer) return { ok: false, reason: 'composer-missing' };
  const value = ${JSON.stringify(prompt)};
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value');
    if (setter && setter.set) setter.set.call(composer, value);
    else composer.value = value;
  } else {
    composer.textContent = value;
  }
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  composer.dispatchEvent(new Event('change', { bubbles: true }));
  const form = composer.closest('form');
  const scope = form ?? document;
  const button = scope.querySelector(${JSON.stringify(selectors.sendButton)});
  if (button instanceof HTMLElement) button.click();
  else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { ok: true };
})()`
}

/** Build the script that reads the newest answer and the streaming state. */
function readScript(selectors: GuestSelectors): string {
  return `(() => {
  const messages = Array.from(document.querySelectorAll(${JSON.stringify(selectors.assistantMessage)}));
  const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const text = last ? (last.innerText ?? '') : '';
  const streaming = document.querySelector(${JSON.stringify(selectors.stopButton)}) !== null;
  return { streaming, text, count: messages.length };
})()`
}

/** Build the script that starts a new conversation. */
function newChatScript(selectors: GuestSelectors): string {
  return `(() => {
  const button = document.querySelector(${JSON.stringify(selectors.newChatButton)});
  if (button instanceof HTMLElement) { button.click(); return { ok: true }; }
  return { ok: false };
})()`
}

/** Wait for the composer to accept input, so a fresh page is not typed into. */
async function waitForComposer(port: GuestPort, selectors: GuestSelectors, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const present = await port.evaluate<boolean>(`document.querySelector(${JSON.stringify(selectors.composer)}) !== null`)
    if (present) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('freechat: the chat guest never rendered a composer')
}

/** One conversation in the guest page. */
class GuestSession implements WebChatSession {
  readonly id: string
  private closed = false

  constructor(
    private readonly port: GuestPort,
    private readonly selectors: GuestSelectors,
    private readonly options: GuestTransportOptions,
    index: number,
  ) {
    this.id = `guest-${index}`
  }

  async *send(prompt: string, signal?: AbortSignal): AsyncIterable<string> {
    if (this.closed) throw new Error('freechat: guest session is closed')
    await waitForComposer(this.port, this.selectors, this.options.readyTimeoutMs)
    // Read the baseline before submitting: once the prompt is sent the page may
    // already begin streaming, and a later read would drop the first tokens of
    // this turn. The page keeps earlier answers, so the baseline also prevents
    // the previous answer from being re-emitted.
    const baseline = await this.port.evaluate<GuestSnapshot>(readScript(this.selectors))
    const submitted = await this.port.evaluate<{ ok: boolean }>(composeScript(prompt, this.selectors))
    if (!submitted.ok) throw new Error('freechat: the chat guest refused the prompt (composer missing)')
    let delivered = baseline.text
    let observedCount = baseline.count
    let changed = false
    let idle = 0
    const deadline = Date.now() + this.options.answerTimeoutMs
    for (;;) {
      if (signal?.aborted === true) throw new Error('freechat: generation aborted')
      if (Date.now() > deadline) throw new Error('freechat: the web chat answer timed out')
      await new Promise(resolve => setTimeout(resolve, this.options.pollMs))
      const snapshot = await this.port.evaluate<GuestSnapshot>(readScript(this.selectors))
      if (snapshot.count > observedCount) {
        // A new answer replaces the old one; its text is not a continuation.
        observedCount = snapshot.count
        if (snapshot.text.length > 0) yield snapshot.text
        delivered = snapshot.text
        changed = true
        idle = 0
      } else if (snapshot.text.startsWith(delivered) && snapshot.text.length > delivered.length) {
        yield snapshot.text.slice(delivered.length)
        delivered = snapshot.text
        changed = true
        idle = 0
      } else if (snapshot.text !== delivered) {
        delivered = snapshot.text
        changed = true
        idle = 0
      } else if (!snapshot.streaming && changed && snapshot.text.length > 0) {
        idle += 1
        if (idle >= this.options.idlePolls) return
      }
    }
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

/** Drives the desktop guest page that hosts the signed-in free chat. */
export class ElectronGuestTransport implements WebChatTransport {
  private readonly options: GuestTransportOptions
  private readonly selectors: GuestSelectors
  private opened = 0

  /**
   * @param options - guest port, selector overrides, polling budget.
   */
  constructor(options: GuestTransportOptions) {
    this.options = options
    this.selectors = options.selectors ?? DEFAULT_GUEST_SELECTORS
  }

  async open(signal?: AbortSignal): Promise<WebChatSession> {
    if (signal?.aborted === true) throw new Error('freechat: guest open aborted')
    const created = await this.options.port.evaluate<{ ok: boolean }>(newChatScript(this.selectors))
    // A site without a new-chat control is served by the page the user already
    // has open; the bridge still records a distinct logical generation.
    if (!created.ok) await waitForComposer(this.options.port, this.selectors, this.options.readyTimeoutMs)
    this.opened += 1
    return new GuestSession(this.options.port, this.selectors, this.options, this.opened)
  }
}
