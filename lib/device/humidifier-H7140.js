import { parseError } from '../utils/functions.js'
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
    this.cacheSpeedPercent = 0

    // Map 1–100% to 1..8 (0 handled separately as off)
    this.percentToSpeedValue = (percent) => {
      const p = Number(percent) || 0
      if (p <= 0) return 0
      return Math.min(Math.max(Math.ceil(p / 12.5), 1), 8)
    }

    // Map 1..8 back to a representative % for the UI
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

    // Reverse lookup: code -> speed value
    this.code2Value = Object.entries(this.value2Code).reduce((acc, [k, code]) => {
      acc[code] = Number(k)
      return acc
    }, {})

    // Service: HumidifierDehumidifier (locked to humidifier)
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Remove CurrentRelativeHumidity so Home doesn't try to do "Rising to..."
    // (We KEEP the humidifier threshold to display "Set to %")
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
    const targetMode = this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
    targetMode.setProps({
      validValues: [this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER],
    })
    targetMode.onGet(() => this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
    targetMode.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
    targetMode.onSet(async (value) => {
      if (value !== this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER) {
        targetMode.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
      }
    })

    // Current state: keep INACTIVE (prevents "Rising to...")
    const curState = this.service.getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
    curState.onGet(() => this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)
    curState.updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)

    // Active (On/Off)
    const activeChar = this.service.getCharacteristic(this.hapChar.Active)
    activeChar.onGet(() =>
      this.cacheActive === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE
    )
    activeChar.onSet(async (value) => this.internalActiveUpdate(value))
    activeChar.updateValue(this.hapChar.Active.INACTIVE)

    // "Set to XX%" display: use humidifier threshold as our Output %
    this.setpointChar =
      this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      || this.service.addCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)

    this.setpointChar.setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    this.setpointChar.onGet(() => this.cacheSpeedPercent)
    this.setpointChar.onSet(async (value) => this.internalSpeedUpdate(value))

    // Initialize to 0 so Home never shows "Updating..."
    this.setpointChar.updateValue(0)

    // Optional: also keep RotationSpeed for apps that show it (Eve/Home+), but it's not needed
    // If you want ONLY one control, comment this block out.
    const speedChar =
      this.service.getCharacteristic(this.hapChar.RotationSpeed)
      || this.service.addCharacteristic(this.hapChar.RotationSpeed)

    speedChar.setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    speedChar.onGet(() => this.cacheSpeedPercent)
    speedChar.onSet(async (value) => this.internalSpeedUpdate(value))
    speedChar.updateValue(0)

    // Log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
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

      // Keep UI stable (avoid "Rising to...")
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE
      )

      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.Active,
          this.cacheActive === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      const percent = Number(value) || 0

      // 0% = OFF
      if (percent <= 0) {
        this.cacheSpeedPercent = 0

        // reflect value in both chars (prevents "Updating...")
        this.setpointChar?.updateValue(0)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)

        if (this.cacheActive !== 'off') {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'stateHumi',
            value: 0,
          })
          this.cacheActive = 'off'
          this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.INACTIVE)
        }

        return
      }

      // Ensure ON
      if (this.cacheActive !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'stateHumi',
          value: 1,
        })
        this.cacheActive = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
      }

      // Map and send scene
      const speedValue = this.percentToSpeedValue(percent)
      const newCode = this.value2Code[speedValue]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: newCode,
      })

      // Cache + reflect to Home
      this.cacheSpeedPercent = percent
      this.setpointChar?.updateValue(percent)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, percent)

      // Keep UI stable
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE
      )

      this.accessory.log(`${platformLang.curSpeed} [${speedValue}] (${percent}%)`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      setTimeout(() => {
        this.setpointChar?.updateValue(this.cacheSpeedPercent)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeedPercent)
      }, 2000)

      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // ON/OFF updates (expects params.state as 'on'/'off')
    if (params.state && params.state !== this.cacheActive) {
      this.cacheActive = params.state

      const isActive = this.cacheActive === 'on'
      this.service.updateCharacteristic(
        this.hapChar.Active,
        isActive ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
      )

      // Keep UI stable
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE
      )

      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    }

    // Speed updates from Govee app (scene code in params.commands)
    ;(params.commands || []).forEach((command) => {
      const speedValue = this.code2Value[command]
      if (!speedValue) return

      const newPercent = this.speedValueToPercent(speedValue)

      // Speed implies ON
      if (this.cacheActive !== 'on') {
        this.cacheActive = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
      }

      if (newPercent !== this.cacheSpeedPercent) {
        this.cacheSpeedPercent = newPercent
        this.setpointChar?.updateValue(newPercent)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, newPercent)
        this.accessory.log(`${platformLang.curSpeed} [${speedValue}] (${newPercent}%)`)
      }

      // Keep UI stable
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE
      )
    })
  }
}
