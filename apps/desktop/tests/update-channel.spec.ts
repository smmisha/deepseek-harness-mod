import { expect, it } from 'vitest'
import { desktopUpdateChannel, desktopUpdatesDisabled } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'stable' })).toBe('stable')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'latest' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})

it('reads a packaged updates switch and keeps updates on when the field is absent', () => {
  expect(desktopUpdatesDisabled({ version: '1.0.0' })).toBe(false)
  expect(desktopUpdatesDisabled({ dshDesktopUpdates: 'disabled' })).toBe(true)
  expect(() => desktopUpdatesDisabled({ dshDesktopUpdates: 'enabled' })).toThrow(/updates setting/u)
  expect(() => desktopUpdatesDisabled({ dshDesktopUpdates: false })).toThrow(/updates setting/u)
  expect(() => desktopUpdatesDisabled(null)).toThrow(/manifest/u)
})
