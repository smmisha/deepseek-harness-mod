// @vitest-environment jsdom
/** ui-theme apply in a document: the motion preference names itself on the root element. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-theme/client'
import { MOTION_ATTRIBUTE } from '../src/appearance.ts'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '../src/theme-settings.ts'

it('names the stored motion level on the document root and clears it on dispose', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const section = { ...ThemeSettingsSchema({} as never), motion: 'reduced' as const }
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE, schema: ThemeSettingsSchema.toJSON(), value: { ...section },
    autoGenerate: true, applies: 'live' as const, secrets: [], revision: 0,
  })
  const events = new TestRemote(ctx, {
    settings: {
      describe: vi.fn(() => Promise.resolve({
        ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace()] },
      })),
      mutate: vi.fn(() => Promise.resolve({ ok: true as const, value: namespace() })),
    },
  })
  events.$host = { home: undefined, isLoopback: true }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await vi.waitFor(() => { expect(document.documentElement.getAttribute(MOTION_ATTRIBUTE)).toBe('reduced') })
  await fiber.dispose()
  expect(document.documentElement.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
})
