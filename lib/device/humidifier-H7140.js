import {
  base64ToHex,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Accessory
    this.accessory = accessory

    // Caches
    this.cacheActive = 'off'
    this.cacheSpeedPercent = 0           // what Home shows (0–100)
    this.cacheSpeedValue = 0             // backend step (0–8)

    // Map 1–100% to 1..8 (0 handled separately as off)
    this.percentToSpeedValue = (percent) => {
      const p = Number(percent) || 0
      if (p <= 0) return 0
      return Math.min(Math.max(Math.ceil(p / 12.5), 1), 8)
    }

    // Map 1..8 -> representative % for UI (used when syncing from Govee -> Home)
    this.speedValueToPercent = (speedValue) => {
      const v = Number(speedValue) || 0
      if (v <= 0) return 0
      const map = { 1: 13, 2: 25, 3: 38, 4: 50, 5: 63, 6: 75, 7: 88, 8: 100 }
      return map[Math.min(Math.max(v, 1), 8)] ?? 0
    }

    // Speed codes (Govee scenes)
    this.value2Code = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    // Reverse lookups for external updates:
    // 1) base64 -> value
    this.code2Value = Object.entries(this.value2Code).reduce((acc, [k, code]) => {
      acc[code] = Number(k)
      return acc
    }, {})

    // 2) decoded hex -> value (more robust if base64 differs)
    this.hex2Value = Object.entries(this.value2Code).reduce((acc, [k, code]) => {
      try {
        const hex = base64ToHex(code)
        acc[hex] = Number(k)
      } catch (_) {
        // ignore
      }
      return acc
    }, {})

    // Service: HumidifierDehumidifier (locked to humidifier)
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Remove CurrentRelativeHumidity so Home doesn't go into "Rising to..."
    // (We keep the humidifier threshold as our "Set to %" slider)
    const removeIfPresent = (char) => {
      try {
        const c = this.service.getCharacteristic(char)
        if (c) this.service.removeCharacteristic(c)
      } catch (_) {
        // ignore
      }
    }
    removeIfPresent(this.hapChar.CurrentRelativeHumidity)
    removeIfPresent(this.hapChar.RelativeHumidityDehumidifierThreshold)

    // Lock target mode to HUMIDIFIER only (no Auto, no Dehumidifier)
    this.targetModeChar = this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
    this.targetModeChar.setProps({
      validValues: [this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER],
    })
    this.targetModeChar.onGet(() => this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
    this.targetModeChar.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
    this.targetModeChar.onSet(async (value) => {
      if (value !== this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER) {
        this.targetModeChar.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
      }
    })

    // Current state: keep INACTIVE to encourage "Set to" not "Rising to"
    this.currentStateChar = this.service.getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
    this.currentStateChar.onGet(() => this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)
    this.currentStateChar.updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)

    // Active (On/Off)
    this.activeChar = this.service.getCharacteristic(this.hapChar.Active)
    this.activeChar.onGet(() =>
      this.cacheActive === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE
    )
    this.activeChar.onSet(async (value) => this.internalActiveUpdate(value))
    this.activeChar.updateValue(this.hapChar.Active.INACTIVE)

    // Home tile "Set to XX%": use Humidifier Threshold as our Output slider
    this.setpointChar =
      this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      || this.service.addCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)

    this.setpointChar.setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    this.setpointChar.onGet(() => this.cacheSpeedPercent)
    this.setpointChar.onSet(async (value) => this.internalSpeedUpdate(value))

    // Initialize setpoint so Home tile doesn't sit at "Updating..."
    this.setpointChar.updateValue(this.cacheSpeedPercent)

    // Log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  // Keep Home UI stable (and avoid "Rising to")
  updateHomeStateUI() {
    this.currentStateChar.updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)
  }

  async internalActiveUpdate(value) {
    try {
      const isActive = value === this.hapChar.Active.ACTIVE
      const newValue = isActive ? 'on' : 'off'
      if (this.cacheActive === newValue) return

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateHumi',
        value: isActive ? 1 : 0,
      })

      this.cacheActive = newValue
      this.activeChar.updateValue(isActive ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE)
      this.updateHomeStateUI()

      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.activeChar.updateValue(
          this.cacheActive === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      const percent = Math.max(0, Math.min(100, Number(value) || 0))
      const newSpeedValue = this.percentToSpeedValue(percent)

      // Always reflect what user set in Home (fixes "Updating..." loops)
      this.cacheSpeedPercent = percent
      this.setpointChar.updateValue(percent)

      // 0% => OFF
      if (percent <= 0) {
        // Only do work if we weren't already off
        if (this.cacheActive !== 'off') {
          await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 0 })
          this.cacheActive = 'off'
          this.activeChar.updateValue(this.hapChar.Active.INACTIVE)
          this.updateHomeStateUI()
          this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
        }
        // Track backend speed as 0
        this.cacheSpeedValue = 0
        return
      }

      // Ensure ON if non-zero setpoint
      if (this.cacheActive !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 1 })
        this.cacheActive = 'on'
        this.activeChar.updateValue(this.hapChar.Active.ACTIVE)
        this.updateHomeStateUI()
        this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
      }

      // Only send to device + log when backend speed changes (1..8)
      if (newSpeedValue !== this.cacheSpeedValue) {
        const newCode = this.value2Code[newSpeedValue]
        await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'ptReal', value: newCode })

        this.cacheSpeedValue = newSpeedValue
        this.accessory.log(`${platformLang.curSpeed} [${newSpeedValue}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.setpointChar.updateValue(this.cacheSpeedPercent)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  // Update Home from device/app changes
  externalUpdate(params) {
    // ON/OFF updates (expects params.state as 'on'/'off')
    if (params.state && params.state !== this.cacheActive) {
      this.cacheActive = params.state
      const isActive = this.cacheActive === 'on'
      this.activeChar.updateValue(isActive ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE)
      this.updateHomeStateUI()
      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    }

    // Speed updates coming from device/Govee app
    ;(params.commands || []).forEach((command) => {
      let speedValue = this.code2Value[command]

      // If not an exact base64 match, try decoded-hex match
      if (!speedValue) {
        try {
          const hex = base64ToHex(command)
          speedValue = this.hex2Value[hex]
        } catch (_) {
          // ignore
        }
      }

      if (!speedValue) return

      // Speed implies ON
      if (this.cacheActive !== 'on') {
        this.cacheActive = 'on'
        this.activeChar.updateValue(this.hapChar.Active.ACTIVE)
        this.updateHomeStateUI()
        this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
      }

      // Only act if backend speed changed
      if (speedValue !== this.cacheSpeedValue) {
        this.cacheSpeedValue = speedValue

        // Update Home setpoint to representative %
        const newPercent = this.speedValueToPercent(speedValue)
        this.cacheSpeedPercent = newPercent
        this.setpointChar.updateValue(newPercent)

        this.accessory.log(`${platformLang.curSpeed} [${speedValue}]`)
      }
    })
  }
}
