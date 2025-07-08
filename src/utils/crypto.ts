import crypto from 'crypto'

const generate128BitKey = (apiKey: string) => {
  const hmac = crypto.createHmac('sha256', apiKey).digest('hex')
  return hmac.slice(0, 32)
}

const encryptAES128BitToken = (key: string, payload: any) => {
  const keyBuffer = Buffer.from(key, 'hex')
  const iv = crypto.randomBytes(16)

  const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, iv)
  let encrypted = cipher.update(payload, 'utf-8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const tokenBuffer = Buffer.concat([iv, encrypted])

  return tokenBuffer.toString('hex')
}

export const encodePayload = (apiKey: string, payload: any) => {
  const payloadString = JSON.stringify(payload)
  const key = generate128BitKey(apiKey)
  const token = encryptAES128BitToken(key, payloadString)
  return token
}
