import { base64ToHex, parseError } from '../utils/functions.js'
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

    // 2) decoded hex of our known codes -> value
    this.knownHex2Value = {}
    this.knownHexList = [] // list of { hex, value } for "contains" matching
    Object.entries(this.value2Code).forEach(([k, code]) => {
      try {
        const hex = base64ToHex(code)
        const value = Number(k)
        this.knownHex2Value[hex] = value
        this.knownHexList.push({ hex, value })
      } catch (_) {
        // ignore
      }
    })

    // Service: HumidifierDehumidifier (locked to humidifier)
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Remove dehumidifier threshold if present (not used)
    const removeIfPresent = (char) => {
      try {
        const c = this.service.getCharacteristic(char)
        if (c) this.service.removeCharacteristic(c)
      } catch (_) {
        // ignore
      }
    }
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

    // Current state: keep INACTIVE (helps avoid “Rising to…” wording)
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

    // IMPORTANT for Apple Home tile “Updating…”:
    // Provide CurrentRelativeHumidity with a stable value and getter.
    // (This is just to satisfy Home UI; we keep current state INACTIVE.)
    this.currentHumidityChar =
      this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity)
      || this.service.addCharacteristic(this.hapChar.CurrentRelativeHumidity)

    this.currentHumidityChar.setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    this.currentHumidityChar.onGet(() => 0) // dummy stable value
    this.currentHumidityChar.updateValue(0)

    // Home tile “Set to XX%”: use Humidifier Threshold as our “speed %”
    this.setpointChar =
      this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      || this.service.addCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)

    this.setpointChar.setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    this.setpointChar.onGet(() => this.cacheSpeedPercent)
    this.setpointChar.onSet(async (value) => this.internalSpeedUpdate(value))

    // Initialize setpoint so tile has a value immediately
    this.setpointChar.updateValue(this.cacheSpeedPercent)

    // Log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  // Keep UI stable
  updateHomeStateUI() {
    this.currentStateChar.updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)
    // also keep the dummy humidity “fresh” to avoid any UI polling weirdness
    this.currentHumidityChar.updateValue(0)
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
          this.cacheActive === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      const percent = Math.max(0, Math.min(100, Number(value) || 0))
      const newSpeedValue = this.percentToSpeedValue(percent)

      // Always reflect Home immediately (prevents “Updating…” loops)
      this.cacheSpeedPercent = percent
      this.setpointChar.updateValue(percent)
      this.updateHomeStateUI()

      // 0% => OFF
      if (percent <= 0) {
        if (this.cacheActive !== 'off') {
          await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 0 })
          this.cacheActive = 'off'
          this.activeChar.updateValue(this.hapChar.Active.INACTIVE)
          this.updateHomeStateUI()
          this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
        }
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

      // Only send + log when backend speed changes
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
        this.updateHomeStateUI()
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  // Detect speed from an incoming command (base64) using multiple strategies
  detectSpeedFromCommand(command) {
    // Strategy 1: exact base64 match
    if (this.code2Value[command]) return this.code2Value[command]

    // Strategy 2: decode to hex and exact match of known hex
    let hex
    try {
      hex = base64ToHex(command)
    } catch (_) {
      return 0
    }
    if (this.knownHex2Value[hex]) return this.knownHex2Value[hex]

    // Strategy 3: hex contains a known payload hex (covers “wrapped” frames)
    const found = this.knownHexList.find(item => hex.includes(item.hex))
    if (found) return found.value

    return 0
  }

  externalUpdate(params) {
    // ON/OFF updates
    if (params.state && params.state !== this.cacheActive) {
      this.cacheActive = params.state
      const isActive = this.cacheActive === 'on'
      this.activeChar.updateValue(isActive ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE)
      this.updateHomeStateUI()
      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    }

    // SPEED updates from device/Govee app
    ;(params.commands || []).forEach((command) => {
      const speedValue = this.detectSpeedFromCommand(command)
      if (!speedValue) {
        // Helpful debug: uncomment if you want to see what the device is actually sending
        // this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}]`)
        return
      }

      // Speed implies ON
      if (this.cacheActive !== 'on') {
        this.cacheActive = 'on'
        this.activeChar.updateValue(this.hapChar.Active.ACTIVE)
        this.updateHomeStateUI()
        this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
      }

      // Only update + log when speed step changes
      if (speedValue !== this.cacheSpeedValue) {
        this.cacheSpeedValue = speedValue

        const newPercent = this.speedValueToPercent(speedValue)
        this.cacheSpeedPercent = newPercent
        this.setpointChar.updateValue(newPercent)
        this.updateHomeStateUI()

        this.accessory.log(`${platformLang.curSpeed} [${speedValue}]`)
      }
    })
  }
}
