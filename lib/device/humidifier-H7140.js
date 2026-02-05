import { hs2rgb } from '../utils/colour.js'
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
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    /**
     * Speed mapping:
     * - HomeKit RotationSpeed: 0..100 (%), minStep 12.5
     * - Device levels: 0..8
     *   0% => off
     *   12.5% => level 1
     *   ...
     *   100% => level 8
     *
     * When receiving a device level from Govee, set HomeKit to the TOP of the bracket:
     * level 4 => 50%, level 8 => 100%, etc.
     */
    this.percentToLevel = (percent) => {
      const p = Number(percent) || 0
      if (p <= 0) return 0
      return Math.min(8, Math.max(1, Math.ceil(p / 12.5)))
    }
    this.levelToPercent = (level) => {
      const lv = Number(level) || 0
      if (lv <= 0) return 0
      return Math.min(100, lv * 12.5)
    }

    // Speed codes (levels 1..8)
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
    this.code2Value = Object.entries(this.value2Code).reduce((acc, [k, v]) => {
      acc[v] = Number(k)
      return acc
    }, {})

    // Track last non-zero level for "restore on power on"
    this.lastNonZeroLevel = 8

    // HomeKit requires a CurrentRelativeHumidity value for HumidifierDehumidifier.
    // This device has no humidity sensor, so we expose a reasonable fixed value.
    // (If you later add an external sensor, we can wire it in here.)
    this.fakeHumidity = 50


    // Add the humidifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Add the night light service if it doesn't already exist
    this.lightService = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // --- Humidifier: Active (On/Off) ---
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))

    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Keep CurrentHumidifierDehumidifierState in sync (no target humidity / no sliders)
    this.service
      .getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState)
      .updateValue(
        this.cacheState === 'on'
          ? this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING
          : this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )


// Restrict TargetHumidifierDehumidifierState to HUMIDIFIER only (hide Auto/Dehumidify where possible)
// Note: This characteristic is required by HomeKit for this service.
this.service
  .getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
  .setProps({
    validValues: [this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER],
  })
  .onSet(async () => this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)
  .updateValue(this.hapChar.TargetHumidifierDehumidifierState.HUMIDIFIER)

// Provide a fixed CurrentRelativeHumidity so HomeKit doesn't show 0%
this.service
  .getCharacteristic(this.hapChar.CurrentRelativeHumidity)
  .updateValue(this.fakeHumidity)

    // --- Humidifier: RotationSpeed (0..100%) ---
    // NOTE: RotationSpeed is not a standard characteristic for HumidifierDehumidifier.
    // Many HomeKit clients still display it; if not, we can fall back to a secondary service.
    this.service
      .addOptionalCharacteristic(this.hapChar.RotationSpeed)

    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 12.5,
      })
      .onSet(async value => this.internalSpeedUpdate(value))

    // Cache initial speed
    this.cacheSpeedLevel = this.percentToLevel(this.service.getCharacteristic(this.hapChar.RotationSpeed).value)
    this.cacheSpeedPercent = this.levelToPercent(this.cacheSpeedLevel)

    if (this.cacheSpeedLevel > 0) {
      this.lastNonZeroLevel = this.cacheSpeedLevel
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalLightStateUpdate(value)
    })
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const turningOn = Boolean(value)
      const newValue = turningOn ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        // If we're turning on and speed is 0, still apply lastNonZeroLevel (HomeKit can send repeated Active=1)
        if (turningOn && this.cacheSpeedLevel === 0) {
          await this.applyLevelAndCache(this.lastNonZeroLevel, { ensureOn: true, snapHomeKit: true })
        }
        return
      }

      if (turningOn) {
        // Turn on first
        await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 1 })
        this.cacheState = 'on'

        // If speed is 0, restore last known non-zero speed
        const restoreLevel = this.cacheSpeedLevel > 0 ? this.cacheSpeedLevel : (this.lastNonZeroLevel || 8)
        await this.applyLevelAndCache(restoreLevel, { ensureOn: false, snapHomeKit: true })

        // Update HK state
        this.service.updateCharacteristic(
          this.hapChar.CurrentHumidifierDehumidifierState,
          this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING,
        )
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
        return
      }

      // turning off
      await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 0 })
      this.cacheState = 'off'

      // Slider goes to 0% (but preserve lastNonZeroLevel)
      this.cacheSpeedLevel = 0
      this.cacheSpeedPercent = 0
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)

      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )

      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  /**
   * Apply a device speed level (1..8), optionally ensuring the humidifier is on, and update caches + HomeKit slider.
   */
  async applyLevelAndCache(level, { ensureOn = false, snapHomeKit = false } = {}) {
    const lv = Math.min(8, Math.max(1, Number(level) || 1))
    const newCode = this.value2Code[lv]

    if (ensureOn && this.cacheState !== 'on') {
      await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'stateHumi', value: 1 })
      this.cacheState = 'on'
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING,
      )
    }

    // Send speed update
    await this.platform.sendDeviceUpdate(this.accessory, { cmd: 'ptReal', value: newCode })

    // Cache
    this.cacheSpeedLevel = lv
    this.cacheSpeedPercent = this.levelToPercent(lv)
    this.lastNonZeroLevel = lv

    // Snap HK slider to the top of the bracket if requested
    if (snapHomeKit) {
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeedPercent)
    }

    this.accessory.log(`${platformLang.curSpeed} [${lv}]`)
  }

  async internalSpeedUpdate(value) {
    try {
      const requestedPercent = Number(value) || 0
      const newLevel = this.percentToLevel(requestedPercent)

      // 0% means Off
      if (newLevel === 0) {
        // If already off, just make sure slider is 0
        if (this.cacheState === 'off' && this.cacheSpeedLevel === 0) {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)
          return
        }

        // Turn off (this will also set slider to 0)
        await this.internalStateUpdate(0)
        return
      }

      // If no effective change and already on, do nothing (but snap slider to bracket top)
      if (newLevel === this.cacheSpeedLevel && this.cacheState === 'on') {
        const snap = this.levelToPercent(newLevel)
        if (requestedPercent !== snap) {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, snap)
        }
        return
      }

      // Apply new level; ensure humidifier is on; snap to bracket top
      await this.applyLevelAndCache(newLevel, { ensureOn: true, snapHomeKit: true })
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeedPercent || 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLightState === newValue) {
        return
      }

      // Generate the hex values for the code
      let hexValues
      if (value) {
        // Calculate current RGB values
        const newRGB = hs2rgb(
          this.lightService.getCharacteristic(this.hapChar.Hue).value,
          this.lightService.getCharacteristic(this.hapChar.Saturation).value,
        )
        hexValues = [0x33, 0x1B, 0x01, this.cacheBright, ...newRGB]
      } else {
        hexValues = [0x33, 0x1B, 0x00]
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate
      if (this.cacheLightState !== newValue) {
        this.cacheLightState = newValue
        this.accessory.log(`${platformLang.curLight} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // --- Humidifier ON/OFF change ---
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state

      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.cacheState === 'on'
          ? this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING
          : this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )

      // If we turned off externally, also drop the slider to 0%
      if (this.cacheState === 'off') {
        this.cacheSpeedLevel = 0
        this.cacheSpeedPercent = 0
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)
      }

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    
// --- Speed level change from structured params (model-specific fields) ---
// Different Govee integrations report speed in different keys; handle a few common ones.
const rawLevel =
  params.speedLevel ?? params.speed ?? params.fanSpeed ?? params.windSpeed ?? params.workSpeed ?? params.humiSpeed
const parsedLevel = Number(rawLevel)
if (Number.isFinite(parsedLevel) && parsedLevel >= 0 && parsedLevel <= 8) {
  const newLevel = Math.round(parsedLevel)
  if (newLevel !== this.cacheSpeedLevel) {
    this.cacheSpeedLevel = newLevel
    this.cacheSpeedPercent = this.levelToPercent(newLevel)
    if (newLevel > 0) {
      this.lastNonZeroLevel = newLevel
      this.cacheState = 'on'
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING,
      )
    } else {
      this.cacheState = 'off'
      this.service.updateCharacteristic(this.hapChar.Active, 0)
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.hapChar.CurrentHumidifierDehumidifierState.INACTIVE,
      )
    }
    this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeedPercent)
    this.accessory.log(`${platformLang.curSpeed} [${newLevel}]`)
  }
}

// --- Try to infer speed changes from commands ---
    // Some devices report changes as raw command base64 blobs. If we see a match,
    // update the cached level and snap HomeKit to the bracket top.
    ;(params.commands || []).forEach((command) => {
      const cmd = String(command).trim()
      // Direct match against known speed codes
      const speedLevel = this.code2Value[cmd]
      if (speedLevel) {
        if (speedLevel !== this.cacheSpeedLevel) {
          this.cacheSpeedLevel = speedLevel
          this.cacheSpeedPercent = this.levelToPercent(speedLevel)
          this.lastNonZeroLevel = speedLevel

          // If speed updated, device is effectively on
          this.cacheState = 'on'
          this.service.updateCharacteristic(this.hapChar.Active, 1)
          this.service.updateCharacteristic(
            this.hapChar.CurrentHumidifierDehumidifierState,
            this.hapChar.CurrentHumidifierDehumidifierState.HUMIDIFYING,
          )
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeedPercent)

          this.accessory.log(`${platformLang.curSpeed} [${speedLevel}]`)
        }
        return
      }

      // Existing handling for night light updates
      const hexString = base64ToHex(cmd)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '1b00': // night light off
        case '1b01': { // night light on
          const newNight = deviceFunction === '1b01' ? 'on' : 'off'
          if (newNight !== this.cacheLightState) {
            this.cacheLightState = newNight
            this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
            this.accessory.log(`current night light state [${this.cacheLightState}]`)
          }
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${cmd}] [${hexString}]`)
          break
      }
    })
  }
}
