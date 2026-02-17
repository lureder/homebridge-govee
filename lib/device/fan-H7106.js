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

    // ---- Light config (optional hide) ----
    const deviceConf = platform.deviceConf?.[accessory.context.gvDeviceId]
    this.hideLight = deviceConf && deviceConf.hideLight

    // ---- Fan codes ----
    this.speedCodes = {
      11: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      22: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      33: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      44: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      55: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      66: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      77: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      88: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    // Remove any old original Fan services
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Add the fan service for the fan if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Fanv2) ||
      this.accessory.addService(this.hapServ.Fanv2)

    // Fan: Active
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Fan: RotationSpeed
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 11,
        minValue: 0,
        validValues: [0, 11, 22, 33, 44, 55, 66, 77, 88, 99],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheMode = this.cacheSpeed === 99 ? 'auto' : 'manual'

    // Fan: SwingMode
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // ---- Night Light service ----
    if (this.hideLight) {
      const existingLight = this.accessory.getService(this.hapServ.Lightbulb)
      if (existingLight) {
        this.accessory.removeService(existingLight)
      }
    } else {
      this.lightService =
        this.accessory.getService(this.hapServ.Lightbulb) ||
        this.accessory.addService(this.hapServ.Lightbulb)

      // Light: On
      this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
        await this.internalLightStateUpdate(value)
      })
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

      // Light: Brightness
      this.lightService.getCharacteristic(this.hapChar.Brightness).onSet(async (value) => {
        await this.internalBrightnessUpdate(value)
      })
      this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

      // Light: Hue (and weâ€™ll read Saturation when needed)
      this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
        await this.internalColourUpdate(value)
      })
      this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
    }

    // Output the customised options to the log
    const opts = JSON.stringify({ hideLight: this.hideLight })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  // -------------------
  // FAN (unchanged)
  // -------------------
  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheState === newValue) return

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      if (value < 11) return
      let newMode = value === 99 ? 'auto' : 'manual'
      if (this.cacheSpeed === value) return

      let codeToSend
      if (newMode === 'auto') {
        if (!this.accessory.context.sensorAttached || !this.cacheAutoCode) {
          this.accessory.logWarn('auto mode not supported without a linked sensor')
          codeToSend = this.speedCodes[88]
          newMode = 'manual'
          value = 88
        } else {
          codeToSend = this.cacheAutoCode
        }
      } else {
        codeToSend = this.speedCodes[value]
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
      })

      if (this.cacheMode !== newMode) {
        this.cacheMode = newMode
        this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
      }
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.accessory.log(`${platformLang.curSpeed} [${value}%]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheSwing === value) return

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=' : 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=',
      })

      if (this.cacheSwing !== newValue) {
        this.cacheSwing = newValue
        this.accessory.log(`${platformLang.curSwing} [${newValue}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  // -------------------
  // LIGHT (ported from the fan+light handler)
  // -------------------
  async internalLightStateUpdate(value) {
    try {
      if (this.hideLight) return

      const newValue = value ? 'on' : 'off'
      if (this.cacheLightState === newValue) return

      // Night light on/off (multiSync)
      const hexValues = [0x3A, 0x1B, 0x01, 0x01, `0x0${value ? '1' : '0'}`]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      if (this.cacheLightState !== newValue) {
        this.cacheLightState = newValue
        this.accessory.log(`${platformLang.curLight} [${newValue}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService?.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      if (this.hideLight) return

      // Debounce
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(350)
      if (updateKeyBright !== this.updateKeyBright) return

      if (value === this.cacheBright) return

      // Night light brightness (multiSync)
      const hexValues = [0x3A, 0x1B, 0x01, 0x02, value]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Govee considers 0% brightness to be off
      if (value === 0) {
        setTimeout(() => {
          this.cacheLightState = 'off'
          if (this.lightService?.getCharacteristic(this.hapChar.On).value) {
            this.lightService.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }
          this.lightService?.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }, 1500)
        return
      }

      if (this.cacheBright !== value) {
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService?.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate(value) {
    try {
      if (this.hideLight) return

      // Debounce
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) return

      if (value === this.cacheHue) return

      const sat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
      const newRGB = hs2rgb(value, sat)

      // Night light colour (multiSync)
      const hexValues = [0x3A, 0x1B, 0x05, 0x0D, ...newRGB]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      if (this.cacheHue !== value) {
        this.cacheHue = value
        this.accessory.log(`${platformLang.curColour} [rgb ${newRGB.join(' ')}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService?.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  // -------------------
  // externalUpdate (fan unchanged + adds light cases)
  // -------------------
  externalUpdate(params) {
    // Fan: Active
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    ;(params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      if (getTwoItemPosition(hexParts, 1) !== 'aa') return

      if (getTwoItemPosition(hexParts, 2) === '08') {
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        // ---------- FAN (existing) ----------
        case '0501': {
          const newSpeed = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeed, 10) * 11
          const newMode = 'manual'
          if (this.cacheMode !== newMode) {
            this.cacheMode = newMode
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
          }
          if (this.cacheSpeed !== newSpeedInt) {
            this.cacheSpeed = newSpeedInt
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
          }
          break
        }
        case '0500': {
          const newMode = getTwoItemPosition(hexParts, 4) === '03' ? 'auto' : 'manual'
          if (this.cacheMode !== newMode) {
            this.cacheMode = newMode
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
            if (this.cacheMode === 'auto' && this.cacheSpeed !== 99) {
              this.cacheSpeed = 99
              this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
              this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
            }
          }
          break
        }
        case '0503': {
          const code = hexToTwoItems(`33${hexString.substring(2, hexString.length - 2)}`)
          this.cacheAutoCode = generateCodeFromHexValues(code.map(p => Number.parseInt(p, 16)))
          break
        }
        case '1f01': {
          const newSwing = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
          }
          break
        }

        // ---------- LIGHT (new) ----------
        case '1b01': {
          // Night light on/off + brightness
          if (this.hideLight || !this.lightService) break

          const newLightState = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheLightState !== newLightState) {
            this.cacheLightState = newLightState
            this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }

          const newBrightness = hexToDecimal(getTwoItemPosition(hexParts, 5))
          if (this.cacheBright !== newBrightness) {
            this.cacheBright = newBrightness
            this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
            this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
          }
          break
        }
        case '1b05': {
          // Night light colour
          if (this.hideLight || !this.lightService) break

          const newR = hexToDecimal(getTwoItemPosition(hexParts, 5))
          const newG = hexToDecimal(getTwoItemPosition(hexParts, 6))
          const newB = hexToDecimal(getTwoItemPosition(hexParts, 7))

          const hs = rgb2hs(newR, newG, newB)

          if (hs[0] !== this.cacheHue) {
            this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
            this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1])
            ;[this.cacheHue] = hs
            this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
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
