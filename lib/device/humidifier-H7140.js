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

    // Add the Humidifier/Dehumidifier service (we will lock it to "Humidifier")
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

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

    // Set initial current state based on active
    this.service
      .getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
      .updateValue(
        this.cacheActive === 'on'
          ? this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING
          : this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )

    // --- Output level slider (0–100%) using RotationSpeed ---
    // Note: Apple Home may or may not show RotationSpeed on this tile, but it's valid.
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

      // Don't continue if the new value is the same as before
      if (this.cacheActive === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateHumi',
        value: isActive ? 1 : 0,
      })

      // Cache + update current state
      this.cacheActive = newValue
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        isActive
          ? this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING
          : this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
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
        // Update cached slider value
        this.cacheSpeedPercent = 0

        // If device is currently on, turn it off
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

      // If it's on a % value that doesn't change anything, do nothing
      if (percent === this.cacheSpeedPercent) {
        return
      }

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
          this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING,
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
    // Check for an ON/OFF change (expects params.state as 'on'/'off')
    if (params.state && params.state !== this.cacheActive) {
      this.cacheActive = params.state

      const isActive = this.cacheActive === 'on'
      this.service.updateCharacteristic(
        this.hapChar.Active,
        isActive ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
      )
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        isActive
          ? this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING
          : this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )

      this.accessory.log(`${platformLang.curState} [${this.cacheActive}]`)
    }

    // If you later add parsing of incoming "speed" from device reports,
    // you can update RotationSpeed here too.
  }
}
