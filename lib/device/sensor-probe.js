import { base64ToHex } from '../utils/functions.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/**
 * A meat thermometer: one or more probes, each reading its own temperature.
 *
 * None of these models has had its readings worked out yet. The H5198 was once
 * given the ordinary thermometer tiles and it went badly - owners saw one probe
 * out of four, stuck at its starting value (#338). A tile showing a number that
 * never changes is worse than no tile, because there is no way to tell it apart
 * from a real reading.
 *
 * So this offers nothing, and instead reports what the device sends in the form
 * that can be pasted into an issue. One owner's log is all that is needed to
 * turn these into real temperature tiles.
 */
export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    // Clear the tiles a previous version gave this device, which never updated
    this.removeServiceIfPresent(this.hapServ.TemperatureSensor)
    this.removeServiceIfPresent(this.hapServ.HumiditySensor)
    this.removeServiceIfPresent(this.hapServ.Battery)

    this.logInitOptions({})
    this.accessory.log('this thermometer\'s readings are not understood yet, so it has no tiles - the lines below are what is needed to add them')
  }

  externalUpdate(params) {
    // The probe readings could arrive as raw commands or as fields on the
    // update itself, and which is not known yet - so both are reported
    ;(params.commands || []).forEach((command) => {
      logUnknownData(this.accessory, {
        kind: 'probe reading',
        source: params.source,
        raw: command,
        hex: base64ToHex(command),
      })
    })

    const fields = Object.keys(params).filter(key => !['commands', 'source'].includes(key))
    if (fields.length > 0) {
      logUnknownData(this.accessory, {
        kind: 'probe update',
        source: params.source,
        raw: JSON.stringify(Object.fromEntries(fields.map(key => [key, params[key]]))),
      })
    }
  }
}
