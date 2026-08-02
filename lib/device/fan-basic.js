import { base64ToHex, getTwoItemPosition, hexToTwoItems, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData, reportUnsupportedControl } from '../utils/report-unknown.js'

/**
 * A fan whose power command is known but whose speeds are not.
 *
 * Govee's power command is the same across every appliance the plugin handles,
 * so on and off can be offered with confidence for a model nobody has tested.
 * The speeds are the part that differs per model, and getting the number of
 * them wrong is worse than not offering them - so the slider reports what it
 * needs and fails the request rather than quietly sending a guess.
 *
 * Once an owner sends in what their fan reports, the model gets its own handler
 * with real speeds and stops using this one.
 */
export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Add the fan service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2)
      || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Offer the speed slider so the fan can report what it wants, but make it
    // clear it does nothing yet rather than sending a guessed command
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 100,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
    this.accessory.log('on and off are supported for this model, the speeds are not known yet')
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function. This power command is
      // the same for every govee appliance, so it is safe for an untested model
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
        openApi: this.accessory.context.openApiCapabilities?.powerSwitch
          ? { instance: 'powerSwitch', capabilityType: 'devices.capabilities.on_off', value: value ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    // 0 is the slider following the fan being turned off, not a speed request
    if (value === 0) {
      return
    }

    reportUnsupportedControl(this.accessory, { control: 'fan speed', value })

    // Put the slider back where it was, and fail the request so HomeKit shows
    // it as not responding - that is what sends the owner to the log
    setTimeout(() => {
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
    }, 2000)
    throw new this.hapErr(-70402)
  }

  externalUpdate(params) {
    // Power is the one thing that can be read back with confidence
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Everything else is reported so the model can be finished off
    ;(params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      // The power report is understood, anything else is worth sending in
      if (getTwoItemPosition(hexParts, 2) === '01') {
        const newState = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
        if (this.cacheState !== newState) {
          this.cacheState = newState
          this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
        }
        return
      }

      logUnknownData(this.accessory, {
        kind: 'scene',
        source: params.source,
        raw: command,
        hex: hexString,
      })
    })
  }
}
