import {
  base64ToHex,
  generateCodeFromHexValues,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform
    this.accessory = accessory

    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    this.swingCodes = {
      0: 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=', // assumed swing OFF (may be incorrect)
      1: 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=', // assumed swing ON (may be incorrect)
    }

    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 1, minValue: 0, maxValue: 100 })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheMode = 'manual'

    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value ?? 0

    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheState === newValue) return

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
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
      let mappedValue
      if (value === 0) mappedValue = 0
      else if (value <= 12.5) mappedValue = 1
      else if (value <= 25) mappedValue = 2
      else if (value <= 37.5) mappedValue = 3
      else if (value <= 50) mappedValue = 4
      else if (value <= 62.5) mappedValue = 5
      else if (value <= 75) mappedValue = 6
      else if (value <= 87.5) mappedValue = 7
      else mappedValue = 8

      if (this.cacheSpeed === mappedValue) return

      const codeToSend = this.speedCodes[mappedValue]
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
      })

      this.cacheSpeed = mappedValue
      this.accessory.log(`${platformLang.curSpeed} [${mappedValue}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed * 12.5)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) {
    try {
      if (this.cacheSwing === value) return

      const codeToSend = this.swingCodes[value]
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
      })

      this.cacheSwing = value
      this.accessory.log(`${platformLang.curSwing} [${value === 1 ? 'on' : 'off'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    (params.commands || []).forEach((command) => {
      // 🔍 NEW: Log all incoming base64 commands
      this.accessory.log(`[DEBUG] Incoming command: ${command}`)

      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Optionally log the decoded hex
      this.accessory.log(`[DEBUG] Decoded hex: ${hexString}`)

      if (getTwoItemPosition(hexParts, 1) !== 'aa') return

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`
      switch (deviceFunction) {
        case '0501': {
          const newSpeed = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeed, 10)
          this.cacheMode = 'manual'
          if (this.cacheSpeed !== newSpeedInt) {
            this.cacheSpeed = newSpeedInt
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed * 12.5)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        // Unknown deviceFunction, log it
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
