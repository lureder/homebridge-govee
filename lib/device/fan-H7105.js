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
    this.hideLight = true

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

    // Oscillation characteristic intentionally not registered

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
        minValue: 0,// This is actually from HAP for Bluetooth LE Specification, but fits
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the fan swing mode
    // Swing/oscillation removed (no registration)

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
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
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
    try {
      const pct = Math.max(0, Math.min(100, Number(value) || 0))

      if (pct === 0) {
        // OFF only if changing state
        if (this.cacheState !== 'off' || this.cacheSpeed !== 0) {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'ptReal',
            value: 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
          })
          this.cacheState = 'off'
          this.cacheSpeed = 0
          this.accessory.log(`${platformLang.curSpeed} [0]`)
        }
        return
      }

      const bucket = Math.max(1, Math.min(12, Math.ceil(pct / (100 / 12))))

      if (this.cacheSpeed !== bucket || this.cacheState !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: this.speedCodes[bucket],
        })
        this.cacheSpeed = bucket
        this.cacheState = 'on'
        this.accessory.log(`${platformLang.curSpeed} [${bucket}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        // Leave UI value as-is per preference
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) { /* removed/no-op */
    try {
      // Don't continue if the new value is the same as before
      if (this.cacheSwing === value) {
        return
      }

      throw new Error('Swing mode update not implemented yet')

      // const newValue = value ? 'on' : 'off'
      // The existing cacheSwingCode might be something like aa1d0101960384000000000000000000000000a6
      // We need to change the third hex value to 00 for off or 01 for on
      // const hexValues = [
      //   0x3A,
      //   0x1D,
      //   value ? 0x01 : 0x00,
      //   ...this.cacheSwingCode.slice(6, 14).match(/.{1,2}/g).map(byte => Number.parseInt(byte, 16)),
      // ]
      //
      // await this.platform.sendDeviceUpdate(this.accessory, {
      //   cmd: 'multiSync',
      //   value: generateCodeFromHexValues(hexValues),
      // })

      // Cache the new state and log if appropriate
      // if (this.cacheSwing !== newValue) {
      //   this.cacheSwing = newValue
      // // (swing log removed)
[this.cacheHue] = hs

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
            // (Swing removed) this.service// (Swing removed) updateCharacteristic(SwingMode, ...)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
          }
          break
        }
        case '1d01':{
          // Swing Mode On
          const newSwing = 'on'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            // (Swing removed) this.service// (Swing removed) updateCharacteristic(SwingMode, ...)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
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
