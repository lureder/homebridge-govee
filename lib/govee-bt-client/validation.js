const h5074_uuid_rev = '88ec'
const h5075_uuid_rev = '88ec'
const h5101_uuid_rev = '0100'
const h5179_uuid_rev = '0188'

export function isHt5074(hex) { // Govee H5074
  return hex.includes(h5074_uuid_rev) && hex.length === 18
}
export function isHt5075(hex) { // Govee H5072/H5075
  return hex.includes(h5075_uuid_rev) && hex.length === 16
}
export const isHt5101 = hex => hex.includes(h5101_uuid_rev) // Govee H5100/H5101/H5102
export function isHt5179(hex) { // Govee H5179
  return hex.includes(h5179_uuid_rev) && hex.length === 22
}

export function isValidPeripheral(peripheral) {
  const { advertisement } = peripheral

  if (!advertisement || !advertisement.manufacturerData) {
    return false
  }

  const hex = advertisement.manufacturerData.toString('hex')

  return !(!isHt5074(hex) && !isHt5075(hex) && !isHt5101(hex) && !isHt5179(hex))
}
