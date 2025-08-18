import util from 'util'

export const infoLog = ({ message, obj }: { message: string; obj?: any }) => {
  const consoleBody = [message]
  if (obj) consoleBody.push(util.inspect(obj, { depth: null, colors: true }))

  console.info(...consoleBody)
}
export const errorLog = ({ message, obj }: { message: string; obj?: any }) => {
  const consoleBody = [message]
  if (obj) consoleBody.push(util.inspect(obj, { depth: null, colors: true }))

  console.error(...consoleBody)
}
