import { base64ToHex, generateCodeFromHexValues, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

// Models here with a night light, reported as status code `aa 1b 01 [on] [level]`
// and set with the matching `33 1b 01 [on] [level]` (H5089, #1323)
const nightLightModels = ['H5089']

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Remove outlet services if they exist
    if (this.accessory.getService('Outlet 1')) {
      this.accessory.removeService(this.accessory.getService('Outlet 1'))
    }
    if (this.accessory.getService('Outlet 2')) {
      this.accessory.removeService(this.accessory.getService('Outlet 2'))
    }

    // A model that used to be treated as a single switch or outlet leaves an
    // unnumbered service behind, which would sit next to the numbered pair as
    // a tile that no longer does anything (#1323)
    this.accessory.services
      .filter(service => !service.subtype
        && [this.hapServ.Switch.UUID, this.hapServ.Outlet.UUID].includes(service.UUID))
      .forEach(service => this.accessory.removeService(service))

    // Add the switch services if they don't already exist
    this.service1 = this.accessory.getService('Switch 1')
      || this.accessory.addService(this.hapServ.Switch, 'Switch 1', 'switch1')
    this.service2 = this.accessory.getService('Switch 2')
      || this.accessory.addService(this.hapServ.Switch, 'Switch 2', 'switch2')

    if (!this.service1.testCharacteristic(this.hapChar.ConfiguredName)) {
      this.service1.addCharacteristic(this.hapChar.ConfiguredName)
      this.service1.updateCharacteristic(this.hapChar.ConfiguredName, 'Switch 1')
    }
    if (!this.service1.testCharacteristic(this.hapChar.ServiceLabelIndex)) {
      this.service1.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service1.updateCharacteristic(this.hapChar.ServiceLabelIndex, 1)
    }
    if (!this.service2.testCharacteristic(this.hapChar.ConfiguredName)) {
      this.service2.addCharacteristic(this.hapChar.ConfiguredName)
      this.service2.updateCharacteristic(this.hapChar.ConfiguredName, 'Switch 2')
    }
    if (!this.service2.testCharacteristic(this.hapChar.ServiceLabelIndex)) {
      this.service2.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service2.updateCharacteristic(this.hapChar.ServiceLabelIndex, 2)
    }

    // Add the set handler to the switch on/off characteristic
    this.service1.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(this.service1, value ? 17 : 16)
    })
    this.service1.cacheState = this.service1.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'
    this.service2.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(this.service2, value ? 34 : 32)
    })
    this.service2.cacheState = this.service2.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add a night light service for the models that have one
    if (nightLightModels.includes(this.accessory.context.gvModel)) {
      this.lightService = this.accessory.getService('Night Light')
        || this.accessory.addService(this.hapServ.Lightbulb, 'Night Light', 'nightlight')
      if (!this.lightService.testCharacteristic(this.hapChar.ConfiguredName)) {
        this.lightService.addCharacteristic(this.hapChar.ConfiguredName)
        this.lightService.updateCharacteristic(this.hapChar.ConfiguredName, 'Night Light')
      }
      this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
        await this.internalLightStateUpdate(value)
      })
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'
      this.lightService.getCharacteristic(this.hapChar.Brightness).onSet(async (value) => {
        await this.internalLightBrightnessUpdate(value)
      })
      this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value || 100
    } else if (this.accessory.getService('Night Light')) {
      this.accessory.removeService(this.accessory.getService('Night Light'))
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'switch',
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // The value is (which outlets to change << 4) | (which of those to turn on)
    // 51 turns BOTH ON
    // 48 turns BOTH OFF
    // 17 turns outlet 1 ON
    // 16 turns outlet 1 OFF
    // 34 turns outlet 2 ON
    // 32 turns outlet 2 OFF
  }

  async internalStateUpdate(service, value) {
    try {
      const newValue = value % 16 === 0 ? 'off' : 'on'

      // Don't continue if the new value is the same as before
      if (service.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateDual',
        value,
      })

      // Cache the new state and log if appropriate
      if (service.cacheState !== newValue) {
        service.cacheState = newValue
        this.accessory.log(`[${service.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        service.updateCharacteristic(this.hapChar.On, service.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  // Govee does not use one night light command across its range: the purifiers
  // that already work here send `33 18 [on] [level]`, while this plug reports
  // its light as `aa 1b 01 [on] [level]`. Mirroring the status code was not
  // enough on its own, so send both shapes - they express the same thing, so
  // whichever the plug ignores costs nothing. Once it is known which one lands
  // this drops to that one alone (#1323)
  async sendLightCommand(state, level) {
    const shapes = [
      [0x33, 0x1B, 0x01, state, level],
      [0x33, 0x18, state, level],
    ]
    let lastError
    for (const hexValues of shapes) {
      try {
        await this.platform.sendDeviceUpdate(this.accessory, {
          // This plug acks the app's commands as `ptIot` and ignores `ptReal`
          cmd: 'ptIot',
          value: generateCodeFromHexValues(hexValues),
        })
      } catch (err) {
        lastError = err
      }
    }
    if (lastError) {
      throw lastError
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheLightState === newValue) {
        return
      }

      // Keep the current level when toggling, so turning the light on does not
      // also change how bright it is
      await this.sendLightCommand(value ? 0x01 : 0x00, this.cacheLightBright)

      this.cacheLightState = newValue
      this.accessory.log(`[Night Light] ${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightBrightnessUpdate(value) {
    try {
      if (value === 0 || this.cacheLightBright === value) {
        return
      }

      // Setting a level also turns the light on, matching how HomeKit sends
      // brightness changes alongside an on command
      await this.sendLightCommand(0x01, value)

      this.cacheLightBright = value
      this.accessory.log(`[Night Light] ${platformLang.curBright} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheLightBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    if (Array.isArray(params.state)) {
      if (params.state[0] !== this.service1.cacheState) {
        this.service1.cacheState = params.state[0]
        this.service1.updateCharacteristic(this.hapChar.On, this.service1.cacheState === 'on')

        this.accessory.log(`[${this.service1.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${this.service1.cacheState}]`)
      }

      if (params.state[1] !== this.service2.cacheState) {
        this.service2.cacheState = params.state[1]
        this.service2.updateCharacteristic(this.hapChar.On, this.service2.cacheState === 'on')

        this.accessory.log(`[${this.service2.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${this.service2.cacheState}]`)
      }
    }

    // The night light reports as `aa 1b 01 [on] [level]` (#1323)
    if (this.lightService && Array.isArray(params.commands)) {
      params.commands.forEach((command) => {
        let hexString
        try {
          hexString = base64ToHex(command)
        } catch {
          return
        }
        if (!hexString.startsWith('aa1b01')) {
          return
        }

        const newState = hexString.substring(6, 8) === '01' ? 'on' : 'off'
        if (newState !== this.cacheLightState) {
          this.cacheLightState = newState
          this.lightService.updateCharacteristic(this.hapChar.On, newState === 'on')
          this.accessory.log(`[Night Light] ${platformLang.curState} [${newState}]`)
        }

        const newBright = Number.parseInt(hexString.substring(8, 10), 16)
        if (newBright >= 1 && newBright <= 100 && newBright !== this.cacheLightBright) {
          this.cacheLightBright = newBright
          this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright)
          this.accessory.log(`[Night Light] ${platformLang.curBright} [${newBright}%]`)
        }
      })
    }
  }
}
