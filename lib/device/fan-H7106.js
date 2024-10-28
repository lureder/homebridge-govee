import {
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Remove any old Fan services
    if (this.accessory.getService(this.hapServ.Fan) || this.accessory.getService(this.hapServ.Fanv2)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan) || this.accessory.getService(this.hapServ.Fanv2))
    }

    // Add the Switch service for the fan if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch) || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the Swing Mode characteristic to control oscillation
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalOscillationUpdate(value))
    this.cacheOscillation = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // Output the customized options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function to turn on/off
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalOscillationUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheOscillation === newValue) {
        return
      }

      // Send the request to the platform sender function to toggle oscillation
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=' : 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=',
      })

      // Cache the new oscillation state and log if appropriate
      this.cacheOscillation = newValue
      this.accessory.log(`Oscillation [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheOscillation === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Update the On characteristic if the state changes externally
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Update the SwingMode characteristic if oscillation changes externally
    if (params.oscillation && params.oscillation !== this.cacheOscillation) {
      this.cacheOscillation = params.oscillation
      this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheOscillation === 'on' ? 1 : 0)
      this.accessory.log(`Oscillation [${this.cacheOscillation}]`)
    }
  }
}
