import { db } from '@/db'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { and, isNull } from 'drizzle-orm'

export const getPortalConnection = async (
  portalId: string,
): Promise<QBTokenSelectSchemaType | null> => {
  const portalSync = await db.query.QBTokens.findFirst({
    where: (QBTokens, { eq }) =>
      and(isNull(QBTokens.deletedAt), eq(QBTokens.portalId, portalId)),
  })

  return portalSync || null
}
