/** Resolve the update channel sealed into the installed application manifest. */
import type { DesktopUpdatePreferences } from './settings-file.ts'

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = DesktopUpdatePreferences['channel']

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'stable') throw new Error('desktop update: invalid packaged channel')
  return channel
}

/**
 * Read whether packaging turned updates off; such an installation ignores any `app-update.yml` left in its
 * resources and has no mandatory update policy.
 * @param manifest Parsed application manifest.
 * @returns True only for an explicit `dshDesktopUpdates: 'disabled'`; an absent field keeps updates on.
 */
export function desktopUpdatesDisabled(manifest: unknown): boolean {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdates' in manifest)) return false
  if (manifest.dshDesktopUpdates !== 'disabled') throw new Error('desktop update: invalid packaged updates setting')
  return true
}
