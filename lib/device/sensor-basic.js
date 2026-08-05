import { base64ToHex } from '../utils/functions.js'
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
    this.logInitOptions({})
    this.accessory.log('this sensor\'s readings are not understood yet, so it has no tiles - the lines below are what is needed to add them')
  }

  externalUpdate(params) {
    // An update arrives as raw commands plus whatever fields came with it, and
    // which of the two carries the readings is exactly what is not known yet -
    // so both are reported. This used to read a `scene` field that nothing ever
    // sets, so every line went out with no payload in it at all, which made the
    // reports it exists to produce useless.
    ;(params.commands || []).forEach((command) => {
      logUnknownData(this.accessory, {
        kind: 'reading',
        source: params.source,
        raw: command,
        hex: base64ToHex(command),
      })
    })

    const fields = Object.keys(params).filter(key => !['commands', 'source'].includes(key))
    if (fields.length > 0) {
      logUnknownData(this.accessory, {
        kind: 'update',
        source: params.source,
        raw: JSON.stringify(Object.fromEntries(fields.map(key => [key, params[key]]))),
      })
    }
  }
}
