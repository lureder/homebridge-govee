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
    logUnknownData(this.accessory, {
      kind: 'scene',
      source: params.source,
      raw: params.scene,
    })
  }
}
