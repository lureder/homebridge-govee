import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

const FAN_SPEED_LEVELS = 12
const UI_ROLLBACK_DELAY_MS = 2000
const LOW_SPEED_SUPPRESS_MS = 3000
const PENDING_BUCKET_TTL_MS = 5000

const POWER_ON_CODE = 'MwEBAAAAAAAAAAAAAAAAAAAAADM='
const POWER_OFF_CODE = 'MwEAAAAAAAAAAAAAAAAAAAAAADI='

export default class FanH7105 {
  constructor(platform, accessory) {
    this.platform = platform
    this.accessory = accessory

    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service

    this._suppressLowUntil = 0
    this._lastBucket = 0      // last bucket sent to the device; survives power cycles
    this._savedSpeedPct = 0   // last slider value before power-off; restored on power-on
    this._pendingBucket = 0   // bucket we're waiting to hear echoed back from the device
    this._pendingBucketTimer = null

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

    this.removeLegacyServices()
    this.setupFanService()

    platform.log(
      '[%s] %s %s.',
      accessory.displayName,
      platformLang.devInitOpts,
      JSON.stringify({ fanOnly: true })
    )
  }

  removeLegacyServices() {
    const legacyFan = this.accessory.getService(this.hapServ.Fan)
    if (legacyFan) {
      this.accessory.removeService(legacyFan)
    }

    const lightService = this.accessory.getService(this.hapServ.Lightbulb)
    if (lightService) {
      this.accessory.removeService(lightService)
    }
  }

  setupFanService() {
    this.service =
      this.accessory.getService(this.hapServ.Fanv2) ||
      this.accessory.addService(this.hapServ.Fanv2)

    this.charActive = this.service.getCharacteristic(this.hapChar.Active)
    this.charRotationSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed)

    this.charActive.onSet(value => this.internalStateUpdate(value))
    this.charRotationSpeed
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onSet(value => this.internalSpeedUpdate(value))

    this.cacheState = this.charActive.value ? 'on' : 'off'
    this.cacheSpeedPct = Number(this.charRotationSpeed.value) || 0
  }

  speedPctToBucket(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0))
    if (pct === 0) {
      return 0
    }

    return Math.max(
      1,
      Math.min(FAN_SPEED_LEVELS, Math.ceil(pct / (100 / FAN_SPEED_LEVELS)))
    )
  }

  bucketToSpeedPct(bucket) {
    const level = Math.max(0, Math.min(FAN_SPEED_LEVELS, Number(bucket) || 0))
    if (level === 0) {
      return 0
    }

    return Math.min(100, Math.ceil(level * (100 / FAN_SPEED_LEVELS)))
  }

  // Mark a bucket as "pending echo". If externalUpdate sees this bucket come back
  // within PENDING_BUCKET_TTL_MS it knows it's just the device confirming our own
  // command and should not move the HomeKit slider. The timer is a safety net in
  // case the device never echoes (e.g. network drop).
  setPendingBucket(bucket) {
    if (this._pendingBucketTimer) {
      clearTimeout(this._pendingBucketTimer)
    }
    this._pendingBucket = bucket
    this._pendingBucketTimer = setTimeout(() => {
      this._pendingBucket = 0
      this._pendingBucketTimer = null
    }, PENDING_BUCKET_TTL_MS)
  }

  clearPendingBucket() {
    if (this._pendingBucketTimer) {
      clearTimeout(this._pendingBucketTimer)
      this._pendingBucketTimer = null
    }
    this._pendingBucket = 0
  }

  async sendDeviceUpdate(payload) {
    await this.platform.sendDeviceUpdate(this.accessory, payload)
  }

  handleUpdateError(err, rollback) {
    this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

    if (rollback) {
      setTimeout(rollback, UI_ROLLBACK_DELAY_MS)
    }

    throw new this.hapErr(-70402)
  }

  async internalStateUpdate(value) {
    const newState = value ? 'on' : 'off'

    if (this.cacheState === newState) {
      return
    }

    try {
      if (newState === 'on') {
        if (this._lastBucket > 0) {
          // Send the last bucket's speed code â€” it powers on AND sets speed in one
          // command. Mark it as pending so externalUpdate won't move the slider when
          // the device echoes back. The slider will be restored to _savedSpeedPct.
          await this.sendDeviceUpdate({
            cmd: 'ptReal',
            value: this.speedCodes[this._lastBucket],
          })
          this.setPendingBucket(this._lastBucket)
          this.cacheState = 'on'
          this.cacheSpeedPct = this._savedSpeedPct
          this.charRotationSpeed.updateValue(this._savedSpeedPct)
          this.charActive.updateValue(1)
          this.accessory.log(`${platformLang.curSpeed} [${this._lastBucket}]`)
        } else {
          // No prior speed â€” fall back to generic power-on.
          await this.sendDeviceUpdate({
            cmd: 'ptReal',
            value: POWER_ON_CODE,
          })
          this.cacheState = 'on'
        }
      } else {
        await this.sendDeviceUpdate({
          cmd: 'ptReal',
          value: POWER_OFF_CODE,
        })
        // Save whatever the slider was showing so it can be restored on power-on.
        this._savedSpeedPct = this.cacheSpeedPct
        this.cacheState = 'off'
        this.cacheSpeedPct = 0
        this.charRotationSpeed.updateValue(0)
      }
    } catch (err) {
      this.handleUpdateError(err, () => {
        this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalSpeedUpdate(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0))

    try {
      if (pct === 0) {
        if (this.cacheState !== 'off' || this.cacheSpeedPct !== 0) {
          await this.sendDeviceUpdate({
            cmd: 'ptReal',
            value: POWER_OFF_CODE,
          })

          this._savedSpeedPct = 0
          this.cacheState = 'off'
          this.cacheSpeedPct = 0

          this.charActive.updateValue(0)
          this.charRotationSpeed.updateValue(0)

          this._suppressLowUntil = Date.now() + LOW_SPEED_SUPPRESS_MS
        }
        return
      }

      const bucket = this.speedPctToBucket(pct)

      // Deduplicate on bucket so dragging within the same range (e.g. 60%â€“65%,
      // both bucket 8) doesn't spam the device with redundant commands.
      if (this._lastBucket !== bucket || this.cacheState !== 'on') {
        await this.sendDeviceUpdate({
          cmd: 'ptReal',
          value: this.speedCodes[bucket],
        })

        // Mark as pending so externalUpdate ignores the device's echo and leaves
        // the slider at the raw percentage the user dragged to.
        this.setPendingBucket(bucket)

        this._lastBucket = bucket
        this.cacheState = 'on'
        // Store the raw HomeKit percentage â€” NOT the bucket-max â€” so the slider
        // stays exactly where the user left it.
        this.cacheSpeedPct = pct

        this.charActive.updateValue(1)
        this.accessory.log(`${platformLang.curSpeed} [${bucket}]`)
      }
    } catch (err) {
      this.handleUpdateError(err, () => {
        this.charRotationSpeed.updateValue(this.cacheSpeedPct)
        this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  parseCommand(command) {
    const hexString = base64ToHex(command)
    const hexParts = hexToTwoItems(hexString)

    if (getTwoItemPosition(hexParts, 1) !== 'aa') {
      return null
    }

    return {
      raw: command,
      hexString,
      hexParts,
      deviceFunction: `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`,
    }
  }

  externalUpdate(params) {
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)

      if (this.cacheState === 'off' && this.cacheSpeedPct !== 0) {
        this._savedSpeedPct = this.cacheSpeedPct
        this.cacheSpeedPct = 0
        this.charRotationSpeed.updateValue(0)
      }
    }

    for (const command of params.commands || []) {
      const parsed = this.parseCommand(command)
      if (!parsed) {
        continue
      }

      const { hexString, hexParts, deviceFunction } = parsed

      if (getTwoItemPosition(hexParts, 2) === '08') {
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        continue
      }

      switch (deviceFunction) {
        case '0501': {
          const newSpeedHex = getTwoItemPosition(hexParts, 4)
          const newSpeedBucket = Number.parseInt(newSpeedHex, 16)

          if (
            this._suppressLowUntil &&
            Date.now() < this._suppressLowUntil &&
            newSpeedBucket <= 1
          ) {
            this._suppressLowUntil = 0
            break
          }

          if (newSpeedBucket === 0) {
            if (this.cacheState !== 'off' || this.cacheSpeedPct !== 0) {
              this._savedSpeedPct = this.cacheSpeedPct
              this.cacheState = 'off'
              this.cacheSpeedPct = 0
              this.charActive.updateValue(0)
              this.charRotationSpeed.updateValue(0)
            }
            break
          }

          // If this bucket matches the one we just sent ourselves, it's the device
          // echoing our own command. Consume the pending marker and leave the slider
          // exactly where the user put it.
          if (this._pendingBucket && newSpeedBucket === this._pendingBucket) {
            this.clearPendingBucket()
            break
          }

          // Otherwise this is a genuine external change (e.g. Govee app).
          // Snap the slider to the bucket-max percentage.
          const newSpeedPct = this.bucketToSpeedPct(newSpeedBucket)

          this.clearPendingBucket()
          this._lastBucket = newSpeedBucket

          if (this.cacheSpeedPct !== newSpeedPct) {
            this.cacheSpeedPct = newSpeedPct
            this._savedSpeedPct = newSpeedPct
            this.charRotationSpeed.updateValue(newSpeedPct)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeedBucket}]`)
          }
          break
        }

        case '0500':
          break

        default:
          this.accessory.logDebugWarn(
            `${platformLang.newScene}: [${command}] [${hexString}]`
          )
          break
      }
    }
  }
}
