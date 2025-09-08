import { hs2rgb, rgb2hs } from '../utils/colour.js'
import {
  base64ToHex,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hexToDecimal,
  hexToTwoItems,
  parseError,
  sleep,
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

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.hideLight = deviceConf && deviceConf.hideLight

    // Codes etc
    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
      9: 'MwUBCQAAAAAAAAAAAAAAAAAAAD4=',
      10: 'MwUBCgAAAAAAAAAAAAAAAAAAAD0=',
      11: 'MwUBCwAAAAAAAAAAAAAAAAAAADw=',
      12: 'MwUBDAAAAAAAAAAAAAAAAAAAADs=',
    }

    // Remove any old original Fan services
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Migrate old %-rotation speed to unitless
    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      if (existingService.getCharacteristic(this.hapChar.RotationSpeed).props.unit === 'percentage') {
        this.accessory.removeService(existingService)
      }
    }

    // Add the fan service for the fan if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 100,
        minStep: 1,
        minValue: 0
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the fan swing mode
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'
    this.cacheSwingCode = ''

    if (this.hideLight) {
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        // Remove the light service if it exists
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      // Add the night light service if it doesn't already exist
      this.lightService = this.accessory.getService(this.hapServ.Lightbulb) || this.accessory.addService(this.hapServ.Lightbulb)

      // Add the set handler to the lightbulb on/off characteristic
      this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
        await this.internalLightStateUpdate(value)
      })
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

      // Add the set handler to the lightbulb brightness characteristic
      this.lightService
        .getCharacteristic(this.hapChar.Brightness)
        .onSet(async (value) => {
          await this.internalBrightnessUpdate(value)
        })
      this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

      // Add the set handler to the lightbulb hue characteristic
      this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
        await this.internalColourUpdate(value)
      })
      this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      hideLight: this.hideLight,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue[this.cacheHue] = hs

              // Log the change
              this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
            }
          }
          break
        }
        case '1d00':{
          // Swing Mode Off
          const newSwing = 'off'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, 0)
            
          }
          break
        }
        case '1d01':{
          // Swing Mode On
          const newSwing = 'on'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, 1)
            
          }
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
