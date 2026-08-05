import { base64ToHex, getTwoItemPosition, hexToTwoItems } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
    this.accessory.logWarn('note that support for this device is under construction, but may not be possible if this is a bluetooth-only device')
  }

  externalUpdate(params) {
    // These are the models actively being worked out, so every payload is worth
    // reporting in the full form rather than as a bare dump - it is the whole
    // reason the accessory exists at this stage
    logUnknownData(this.accessory, {
      kind: 'payload',
      source: params.source,
      raw: params,
    })

    // Check the status frames for anything else that changed
    ;(params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        default:
          logUnknownData(this.accessory, {
            kind: 'status',
            source: params.source,
            raw: command,
            hex: hexString,
          })
          break
      }
    })
  }
}
