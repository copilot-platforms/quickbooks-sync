import util from 'util'

export const infoLog = ({ message, obj }: { message: string; obj?: any }) => {
  console.info(message, util.inspect(obj, { depth: null, colors: true }))
}
export const errorLog = ({ message, obj }: { message: string; obj?: any }) => {
  console.error(message, util.inspect(obj, { depth: null, colors: true }))
}
