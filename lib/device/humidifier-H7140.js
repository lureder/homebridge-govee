import { parseError } from '../utils/functions.js'
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

    // Map 1–100% to 1..8 (0 is handled separately as "off")
    this.percentToSpeedValue = (percent) => {
      const p = Number(percent) || 0
      if (p <= 0) return 0
      // 1..100 -> 1..8 using 12.5% buckets
      return Math.min(Math.max(Math.ceil(p / 12.5), 1), 8)
    }

    // Map 1..8 back to a representative % for the UI
    this.speedValueToPercent = (speedValue) => {
      const v = Number(speedValue) || 0
      if (v <= 0) return 0
      // Representative %s for each bucket
      const map = {
        1: 13,
        2: 25,
        3: 38,
        4: 50,
        5: 63,
        6: 75,
        7: 88,
        8: 100,
      }
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

    // Add the Humidifier/Dehumidifier service (we will lock it to "Humidifier")
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // --- A) Prevent Apple Home from showing "Rising to ..." ---
    // Remove humidity-related characteristics if they exist (or were cached/added elsewhere).
    const removeIfPresent = (char) => {
      try {
        const c = this.service.getCharacteristic(char)
        if (c) this.service.removeCharacteristic(c)
      } catch (_) {
        // ignore
      }
    }
    removeIfPresent(this.hapChar.CurrentRelativeHumidity)
    removeIfPresent(this.hapChar.RelativeHumidityHumidifierThreshold)
    removeIfPresent(this.hapChar.RelativeHumidityDehumidifierThreshold)

    // --- Lock target mode to HUMIDIFIER only (no Auto, no Dehumidifier) ---
    const targetStateChar = this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)

    targetStateChar.setProps({
      validValues: [
        this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER,
      ],
    })

    // Force it to Humidifier now
    targetStateChar.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)

    // Defensive: if any client tries to set a different mode, snap back
    targetStateChar.onSet(async (value) => {
      if (value !== this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER) {
        targetStateChar.updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
      }
    })

    // --- Active (On/Off) ---
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async (value) => this.internalActiveUpdate(value))

    this.cacheActive =
      this.service.getCharacteristic(this.hapChar.Active).value === this.hapChar.Active.ACTIVE
        ? 'on'
        : 'off'

    // Set initial current state (keep it INACTIVE to avoid "Rising to" UI)
    this.service
      .getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
      .updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)

    // --- Output level slider (0–100%) using RotationSpeed ---
    const speedChar =
      this.service.getCharacteristic(this.hapChar.RotationSpeed)
      || this.service.addCharacteristic(this.hapChar.RotationSpeed)

    speedChar
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onSet(async (value) => this.internalSpeedUpdate(value))

    this.cacheSpeedPercent = Number(speedChar.value) || 0

    // Output the customised options to the log
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

      // Keep current state INACTIVE to avoid "Rising to" UI in Apple Home
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
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

      // 0% = OFF (also turn the device off)
      if (percent <= 0) {
        this.cacheSpeedPercent = 0

        if (this.cacheActive !== 'off') {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'stateHumi',
            value: 0,
          })

          this.cacheActive = 'off'
          this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.INACTIVE)
          this.service.updateCharacteristic(
            this.hapChar.CurrentHumidifierDehumidifierState,
            this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
          )

          this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
        }
        return
      }

      if (percent === this.cacheSpeedPercent) return

      // Ensure device is ON if user sets a non-zero output
      if (this.cacheActive !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'stateHumi',
          value: 1,
        })

        this.cacheActive = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
        this.service.updateCharacteristic(
          this.hapChar.CurrentHumidifierDehumidifierState,
          this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
        )

        this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
      }

      // Map 1–100% -> 1..8 and send the matching code
      const speedValue = this.percentToSpeedValue(percent)
      const newCode = this.value2Code[speedValue]

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: newCode,
      })

      this.cacheSpeedPercent = percent
      this.accessory.log(`${platformLang.curSpeed} [${speedValue}] (${percent}%)`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      setTimeout(() => {
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

      // Keep current state INACTIVE to avoid "Rising to" UI
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )

      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    }

    // SPEED updates coming from the device/Govee app (scene codes)
    ;(params.commands || []).forEach((command) => {
      const speedValue = this.code2Value[command]
      if (!speedValue) return

      // Speed implies device is ON
      if (this.cacheActive !== 'on') {
        this.cacheActive = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
        this.service.updateCharacteristic(
          this.hapChar.CurrentHumidifierDehumidifierState,
          this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
        )
      }

      const newPercent = this.speedValueToPercent(speedValue)

      if (newPercent !== this.cacheSpeedPercent) {
        this.cacheSpeedPercent = newPercent
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, newPercent)
        this.accessory.log(`${platformLang.curSpeed} [${speedValue}] (${newPercent}%)`)
      }
    })
  }
}
