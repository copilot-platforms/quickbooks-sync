import { db } from '@/db'
import { QBPortalConnectionSelectSchemaType } from '@/db/schema/qbPortalConnections'
import { and, isNull } from 'drizzle-orm'

export const getPortalConnection = async (
  portalId: string,
): Promise<QBPortalConnectionSelectSchemaType | null> => {
  const portalSync = await db.query.QBPortalConnection.findFirst({
    where: (QBPortalConnection, { eq }) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.portalId, portalId),
      ),
  })

  return portalSync || null
}

export const getSyncedPortalConnection = async (
  portalId: string,
): Promise<QBPortalConnectionSelectSchemaType | null> => {
  const portalSync = await db.query.QBPortalConnection.findFirst({
    where: (QBPortalConnection, { eq }) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.portalId, portalId),
        eq(QBPortalConnection.syncFlag, true),
      ),
  })

  return portalSync || null
}
