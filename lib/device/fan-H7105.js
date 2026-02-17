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
    this._suppressLowUntil = 0
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    this.accessory = accessory

    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.hideLight = false

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

    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      if (existingService.getCharacteristic(this.hapChar.RotationSpeed).props.unit === 'percentage') {
        this.accessory.removeService(existingService)
      }
    }

    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 100,
        minStep: 1,
        minValue: 0
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    if (this.hideLight) {
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      this.lightService = this.accessory.getService(this.hapServ.Lightbulb) || this.accessory.addService(this.hapServ.Lightbulb)

      this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
        await this.internalLightStateUpdate(value)
      })
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

      this.lightService
        .getCharacteristic(this.hapChar.Brightness)
        .onSet(async (value) => {
          await this.internalBrightnessUpdate(value)
        })
      this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

      this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
        await this.internalColourUpdate(value)
      })
      this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
    }

    const opts = JSON.stringify({
      hideLight: this.hideLight,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      if (this.cacheState === newValue) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      if (this.cacheState !== newValue) {
        this.cacheState = newValue
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
      const pct = Math.max(0, Math.min(100, Number(value) || 0))

      if (pct === 0) {
        if (this.cacheState !== 'off' || this.cacheSpeed !== 0) {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'ptReal',
            value: 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
          })
          this.cacheState = 'off'
          this.cacheSpeed = 0
          this.service.updateCharacteristic(this.hapChar.Active, 0)
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)
          this._suppressLowUntil = Date.now() + 3000
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
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) {
    try {
      if (this.cacheSwing === value) {
        return
      }

      throw new Error('Swing mode update not implemented yet')

    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      setTimeout(() => {
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      if (this.cacheLightState === newValue) {
        return
      }

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
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(350)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }

      if (value === this.cacheBright) {
        return
      }

      const hexValues = [0x3A, 0x1B, 0x01, 0x02, value]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      if (value === 0) {
        setTimeout(() => {
          this.cacheLightState = 'off'
          if (this.lightService.getCharacteristic(this.hapChar.On).value) {
            this.lightService.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }
          this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
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
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate(value) {
    try {
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      if (value === this.cacheHue) {
        return
      }

      const newRGB = hs2rgb(value, this.lightService.getCharacteristic(this.hapChar.Saturation).value)

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
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
    }

    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      if (getTwoItemPosition(hexParts, 2) === '08') {
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '0501': {
          const newSpeed = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeed, 16)
          if (this._suppressLowUntil && Date.now() < this._suppressLowUntil && newSpeedInt <= 1) {
            this._suppressLowUntil = 0
            break
          }

          if (newSpeedInt === 0) {
            if (this.cacheState !== 'off' || this.cacheSpeed !== 0) {
              this.cacheState = 'off'
              this.cacheSpeed = 0
              this.service.updateCharacteristic(this.hapChar.Active, 0)
              this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)
            }
            break
          }

          if (this.cacheSpeed !== newSpeedInt) {
            this.cacheSpeed = newSpeedInt
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, Math.min(100, Math.ceil(this.cacheSpeed * (100 / 12))))
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        case '0500': {
          break
        }
        case '1b01': {
          if (!this.hideLight) {
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
          }
          break
        }
        case '1b05': {
          if (!this.hideLight) {
            const newR = hexToDecimal(getTwoItemPosition(hexParts, 5))
            const newG = hexToDecimal(getTwoItemPosition(hexParts, 6))
            const newB = hexToDecimal(getTwoItemPosition(hexParts, 7))

            const hs = rgb2hs(newR, newG, newB)

            if (hs[0] !== this.cacheHue) {
              this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
              this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1]);
              [this.cacheHue] = hs

              this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
            }
          }
          break
        }
        case '1d00':{
          const newSwing = 'off'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
          }
          break
        }
        case '1d01':{
          const newSwing = 'on'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
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
