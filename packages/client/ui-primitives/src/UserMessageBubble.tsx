/** Shared user-message background, typography, and content inset. */
import type { ComponentPropsWithoutRef } from 'react'
import clsx from 'clsx'
import css from './UserMessageBubble.module.css'

/** Native div attributes for user-authored message content. */
export type UserMessageBubbleProps = ComponentPropsWithoutRef<'div'>

/**
 * Render user-style message content without row placement or actions.
 *
 * The content is user-authored, so its base direction resolves from the text
 * itself (`dir="auto"`): Arabic or Hebrew lays out right to left, including the
 * alignment a caller's own styles inherit, instead of following the page.
 * @param props - Native div attributes and the caller-owned content; an explicit
 * `dir` still overrides the automatic base direction.
 * @returns A theme-aware message surface that wraps its content.
 */
export function UserMessageBubble({ className, ...props }: UserMessageBubbleProps) {
  return <div dir="auto" {...props} className={clsx(css.bubble, className)} />
}
