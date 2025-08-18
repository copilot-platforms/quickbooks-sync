import util from 'util'

const CustomLogger = {
  info({ message, obj }: { message: string; obj?: any }) {
    const consoleBody = [message]
    if (obj) consoleBody.push(util.inspect(obj, { depth: null, colors: true }))

    console.info(...consoleBody)
  },
  error({ message, obj }: { message: string; obj?: any }) {
    const consoleBody = [message]
    if (obj) consoleBody.push(util.inspect(obj, { depth: null, colors: true }))

    console.error(...consoleBody)
  },
}

export default CustomLogger
