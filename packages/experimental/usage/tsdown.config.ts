import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

/** The public Remote boundary types, published beside the Host bundle. */
const types: UserConfig = {
  entry: { types: 'lib/types/types.js' },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
}

export default clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true, companions: [types] })
