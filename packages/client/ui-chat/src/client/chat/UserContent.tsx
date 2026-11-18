/** Reusable user contents inside a caller-owned message row. */
import { Fragment } from 'react'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { fileExtension, FileTypeIcon, fileSizeText, JsonBlock, UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserContentAttachment } from '../contract/slots.ts'
import css from './MessageItem.module.css'

const EMPTY_LABELS: readonly string[] = []

type RenderImages = FactoryComponentPropsOf<'conversation.chat.user.content'>['renderSlot']

/**
 * Render one message's ordered attachments: images through the user image
 * position and files as file cards, without the text bubble or message chrome.
 *
 * The repaired row and the in-place edit context share this presentation: the
 * edit context renders the same Content Factory with the message text
 * suppressed, so editing never changes how the attachments look.
 * @param props - the prepared attachments, the authorized image loader, and the
 * image Slot renderer of the enclosing Content Factory.
 * @returns the wrapping attachment flow.
 */
function UserAttachments({ attachments, loadImage, renderImages }: {
  readonly attachments: readonly UserContentAttachment[]
  readonly loadImage: FactoryComponentPropsOf<'conversation.chat.user.content'>['loadImage']
  readonly renderImages: RenderImages
}) {
  // More than one attachment uses compact image tiles so files and images share
  // a row until the available width wraps them.
  const compactImages = attachments.length > 1
  return (
    <div className={css.attachmentRow} data-message-attachments>
      {attachments.map((attachment, index) => attachment.type === 'image'
        ? (
          <Fragment key={`image:${index}`}>
            {renderImages('conversation.chat.user.images', {
              images: [attachment.image], loadImage, align: 'end', compact: compactImages,
            })}
          </Fragment>
        )
        : (
          <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
            <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
            <span className={css.fileContent}>
              <span className={css.fileName}>{attachment.file.name}</span>
              <span className={css.fileMeta}>
                {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                  .filter(Boolean).join(' ')}
              </span>
            </span>
          </span>
        ))}
    </div>
  )
}

/**
 * Render prepared text, ordered attachments, and references without message chrome.
 * The caller owns row identity, pending/echo state, time, and message actions.
 * @param props - prepared content, facts, authorized image loader, and framework Factory/locale seats.
 * @returns the content stack using the existing user-message layout.
 */
export function UserContent({ content, loadImage, facts, interactive = false, ellipsis = false, renderSlot, renderFactorySlot, t }:
FactoryComponentPropsOf<'conversation.chat.user.content'>) {
  const { text, attachments, extraBlocks, referenceLabels = EMPTY_LABELS } = content
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || extraBlocks.length > 0
  return (
    <div className={css.userStack}>
      {attachments.length > 0 && (
        <UserAttachments attachments={attachments} loadImage={loadImage} renderImages={renderSlot} />
      )}
      {showBubble && <UserMessageBubble data-message-bubble="" data-text-interaction-source="">
        {renderFactorySlot('conversation.user.text', { text, facts, interactive, ellipsis })}
        {extraBlocks.map((block, index) => (
          <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />
        ))}
      </UserMessageBubble>}
      {referenceLabels.length > 0 && (
        <div className={css.referenceSummary}>
          {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
        </div>
      )}
    </div>
  )
}
