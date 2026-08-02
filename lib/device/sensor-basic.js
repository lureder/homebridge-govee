import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/**
 * A sensor whose broadcasts are not decoded yet.
 *
 * It offers no tile, because a tile that never updates is worse than none. What
 * it does is report every message it receives in one copy-paste line, so an
 * owner can send in exactly what is needed to finish the model off.
 */
export default class GoveeSensorBasic extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  externalUpdate(params) {
    logUnknownData(this.accessory, {
      kind: 'scene',
      source: params.source,
      raw: params.scene,
    })
  }
}
