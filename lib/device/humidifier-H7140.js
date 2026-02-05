import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
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

    // 8 speed codes (same as you had originally)
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

    // Cache
    this.cacheState = 'off'        // 'on' | 'off'
    this.cacheSpeed = 0            // backend step 0..8
    this.cachePercent = 0          // UI setpoint 0..100

    // % -> 1..8 bucket (0 stays 0)
    this.pctToBucket = (pct) => {
      const p = Math.max(0, Math.min(100, Number(pct) || 0))
      if (p === 0) return 0
      return Math.max(1, Math.min(8, Math.ceil(p / (100 / 8))))
    }

    // 1..8 bucket -> representative percent for UI
    this.bucketToPct = (bucket) => {
      const b = Math.max(0, Math.min(8, Number(bucket) || 0))
      if (b === 0) return 0
      // (matches bucket boundaries; same style as your fan code)
      return Math.min(100, Math.ceil(b * (100 / 8)))
    }

    // ---- Service: HumidifierDehumidifier (locked to HUMIDIFIER) ----
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Lock target mode to HUMIDIFIER only
    this.service
      .getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER],
      })
      .onGet(() => this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
      .updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)

    // Keep current state INACTIVE to avoid "Rising to"
    this.service
      .getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
      .onGet(() => this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)
      .updateValue(this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE)

    // Active
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onGet(() => (this.cacheState === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE))
      .onSet(async (value) => this.internalStateUpdate(value))
      .updateValue(this.hapChar.Active.INACTIVE)

    // To prevent "Updating..." in Apple Home tiles that expect a current humidity:
    // Provide a stable CurrentRelativeHumidity with a getter.
    this.service
      .getCharacteristic(this.hapChar.CurrentRelativeHumidity)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => 0)
      .updateValue(0)

    // â€œSet to %â€ shown in Home: use RelativeHumidityHumidifierThreshold as the slider
    this.setpointChar =
      this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      || this.service.addCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)

    this.setpointChar
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.cachePercent)
      .onSet(async (value) => this.internalSpeedUpdate(value))
      .updateValue(this.cachePercent)

    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  // Keep UI stable
  updateUiStable() {
    this.service.updateCharacteristic(
      this.hapChar.CurrentHumidifierDehumidifierState,
      this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
    )
    this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, 0)
  }

  async internalStateUpdate(value) {
    try {
      const isActive = value === this.hapChar.Active.ACTIVE
      const newValue = isActive ? 'on' : 'off'
      if (this.cacheState === newValue) return

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateHumi',
        value: isActive ? 1 : 0,
      })

      this.cacheState = newValue
      this.updateUiStable()
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.Active,
          this.cacheState === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      const pct = Math.max(0, Math.min(100, Number(value) || 0))

      // Always reflect immediately in Home (avoids "Updating")
      this.cachePercent = pct
      this.setpointChar.updateValue(pct)
      this.updateUiStable()

      // 0% => OFF
      if (pct === 0) {
        if (this.cacheState !== 'off' || this.cacheSpeed !== 0) {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'stateHumi',
            value: 0,
          })
          this.cacheState = 'off'
          this.cacheSpeed = 0
          this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.INACTIVE)
          this._suppressLowUntil = Date.now() + 3000
          this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
        }
        return
      }

      // Ensure ON
      if (this.cacheState !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'stateHumi',
          value: 1,
        })
        this.cacheState = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }

      // Bucket to 1..8
      const bucket = this.pctToBucket(pct)

      // Only send + log when bucket changes
      if (bucket !== this.cacheSpeed) {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: this.speedCodes[bucket],
        })
        this.cacheSpeed = bucket
        this.accessory.log(`${platformLang.curSpeed} [${bucket}]`)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.setpointChar.updateValue(this.cachePercent)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // ON/OFF sync
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(
        this.hapChar.Active,
        this.cacheState === 'on' ? this.hapChar.Active.ACTIVE : this.hapChar.Active.INACTIVE,
      )
      this.updateUiStable()
    }

    // Fan-style parsing of speed updates from query frames
    ;(params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Must be an "aa" device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '0501': { // speed update (same pattern as your fan)
          const newSpeedHex = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeedHex, 16)

          // Suppress a weird low-speed echo right after turning off (same trick as fan)
          if (this._suppressLowUntil && Date.now() < this._suppressLowUntil && newSpeedInt <= 1) {
            this._suppressLowUntil = 0
            break
          }

          // If device reports 0 => off
          if (newSpeedInt === 0) {
            if (this.cacheState !== 'off' || this.cacheSpeed !== 0) {
              this.cacheState = 'off'
              this.cacheSpeed = 0
              this.cachePercent = 0
              this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.INACTIVE)
              this.setpointChar.updateValue(0)
              this.updateUiStable()
              this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
            }
            break
          }

          // Clamp to 1..8 for this device
          const clamped = Math.max(1, Math.min(8, newSpeedInt))

          // Mark ON if speed is non-zero
          if (this.cacheState !== 'on') {
            this.cacheState = 'on'
            this.service.updateCharacteristic(this.hapChar.Active, this.hapChar.Active.ACTIVE)
            this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          }

          // Update Home only when step changes
          if (this.cacheSpeed !== clamped) {
            this.cacheSpeed = clamped
            const pct = this.bucketToPct(clamped)
            this.cachePercent = pct
            this.setpointChar.updateValue(pct)
            this.updateUiStable()
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        default:
          // Keep this off unless you're debugging:
          // this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
