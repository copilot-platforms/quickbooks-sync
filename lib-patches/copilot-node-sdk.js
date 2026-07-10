import { DefaultService as Copilot, OpenAPI } from '../codegen/api'
import { decryptAES128BitToken, generate128BitKey } from '../utils/crypto'
const sdk = Copilot
function processToken(token) {
  try {
    const json = JSON.parse(token)
    // workspaceId is the only required field
    if (!('workspaceId' in json)) {
      throw new Error('Missing required field in token payload: workspaceId')
    }
    const areAllKeysValid = Object.keys(json).every((key) =>
      [
        'workspaceId',
        'companyId',
        'clientId',
        'internalUserId',
        'notificationId',
        // patched below keys for SDK to work and not throw error
        'baseUrl',
        'instanceId',
      ].includes(key),
    )
    if (!areAllKeysValid) {
      throw new Error('Invalid keys in token payload.')
    }
    const areAllValuesValid = Object.values(json).every(
      (val) => typeof val === 'string',
    )
    if (!areAllValuesValid) {
      throw new Error('Invalid values in token payload.')
    }
    const result = {
      companyId: json.companyId,
      clientId: json.clientId,
      internalUserId: json.internalUserId,
      workspaceId: json.workspaceId,
      notificationId: json.notificationId,
    }
    return result
  } catch (e) {
    if (process.env.COPILOT_DEBUG) {
      console.error(e)
    }
    return null
  }
}
export function copilotApi({ apiKey, token: tokenString }) {
  var _a
  let key = ['local', '__SECRET_STAGING__'].includes(
    (_a = process.env.COPILOT_ENV) !== null && _a !== void 0 ? _a : '',
  )
    ? apiKey
    : undefined
  if (process.env.COPILOT_DEBUG) {
    console.log('Debugging the copilotApi init script.')
    console.log({ env: process.env.COPILOT_ENV })
  }
  if (tokenString) {
    if (process.env.COPILOT_DEBUG) {
      console.log({ tokenString, apiKey })
    }
    try {
      const decipherKey = generate128BitKey(apiKey)
      const decryptedPayload = decryptAES128BitToken(decipherKey, tokenString)
      if (process.env.COPILOT_DEBUG) {
        console.log('Decrypted Payload:', decryptedPayload)
      }
      const payload = processToken(decryptedPayload)
      if (!payload) {
        throw new Error('Invalid token payload.')
      }
      if (process.env.COPILOT_DEBUG) {
        console.log('Payload:', payload)
      }
      sdk.getTokenPayload = () => new Promise((resolve) => resolve(payload))
      key = `${payload.workspaceId}/${apiKey}`
    } catch (error) {
      console.error(error)
    }
  }
  if (!key) {
    console.warn(
      'We were unable to authorize the SDK. If you are working in a local development environment, set the COPILOT_ENV environment variable to "local".',
    )
    throw new Error('Unable to authorize Copilot SDK.')
  }
  if (process.env.COPILOT_DEBUG) {
    console.log(`Authorizing with key: ${key}`)
  }
  OpenAPI.HEADERS = {
    'X-API-Key': key,
  }
  return sdk
}
//# sourceMappingURL=init.js.map
