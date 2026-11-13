import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `common` locale namespace the build signature reads.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/** Props of the name occupant: the shared locale seat and whether this is an unofficial build. */
export type OfficialBrandNameProps = PropsLocale<'common'> & {
  /** True for builds outside the official release profile, which carry the small engraved signature. */
  readonly modBuild: boolean
}

/**
 * Render the official name artwork without its independently slotted mark, followed by a
 * tiny engraved signature on unofficial builds so they never pass for the official release.
 * @param props - the common locale seat and the build kind.
 * @returns the official name wordmark, with the signature when `modBuild` is true.
 */
export function OfficialBrandName({ t, modBuild }: OfficialBrandNameProps) {
  if (!modBuild) return <BrandWordmark includeMark={false} />
  return (
    <span className={css.lockup}>
      <BrandWordmark includeMark={false} />
      <span className={css.signature}>{t('brand.signature')}</span>
    </span>
  )
}
