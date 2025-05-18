import process from 'node:process'

import noble from '@stoprocent/noble'

import { decodeAny } from './decode.js'
import { isValidPeripheral } from './validation.js'

process.env.NOBLE_REPORT_ALL_HCI_EVENTS = '1' // needed on Linux including Raspberry Pi

const h5075_uuid = 'ec88'
const h5101_uuid = '0001'

let DEBUG = false

let discoverCallback
let scanStartCallback
let scanStopCallback

noble.on('discover', async (peripheral) => {
  const { id, uuid, address, state, rssi, advertisement } = peripheral
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('discovered', id, uuid, address, state, rssi)
  }

  if (!isValidPeripheral(peripheral)) {
    if (DEBUG) {
      let mfgData
      if (advertisement.manufacturerData) {
        mfgData = advertisement.manufacturerData.toString('hex')
      }
      // eslint-disable-next-line no-console
      console.log(`invalid peripheral, manufacturerData=[${mfgData}]`)
    }
    return
  }

  const { localName, manufacturerData } = advertisement

  const streamUpdate = manufacturerData.toString('hex')

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`${id}: ${streamUpdate}`)
  }

  const decodedValues = decodeAny(streamUpdate)

  const current = {
    uuid,
    address,
    model: localName,
    battery: decodedValues.battery,
    humidity: decodedValues.humidity,
    tempInC: decodedValues.tempInC,
    tempInF: decodedValues.tempInF,
    rssi,
  }

  if (discoverCallback) {
    discoverCallback(current)
  }
})

noble.on('scanStart', () => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('scanStart')
  }
  if (scanStartCallback) {
    scanStartCallback()
  }
})

noble.on('scanStop', () => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('scanStop')
  }
  if (scanStopCallback) {
    scanStopCallback()
  }
})

export function debug(on) {
  DEBUG = on
}

export async function startDiscovery(callback) {
  discoverCallback = callback

  await noble.startScanningAsync([h5075_uuid, h5101_uuid], true)
}

export async function stopDiscovery() {
  await noble.stopScanningAsync()

  discoverCallback = undefined
  scanStartCallback = undefined
  scanStopCallback = undefined
}

export function registerScanStart(callback) {
  scanStartCallback = callback
}

export function registerScanStop(callback) {
  scanStopCallback = callback
}
