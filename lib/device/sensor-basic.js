import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'

/**
 * A sensor whose broadcasts are not decoded yet.
 *
 * It offers no tile, because a tile that never updates is worse than none. What
 * it does is report every message it receives in one copy-paste line, so an
 * owner can send in exactly what is needed to finish the model off.
 */
export default class GoveeSensorBasic {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

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
