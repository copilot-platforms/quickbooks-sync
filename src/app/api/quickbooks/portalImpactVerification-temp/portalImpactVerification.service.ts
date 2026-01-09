import { MAX_INVOICE_LIST_LIMIT } from '@/app/api/core/constants/limit'
import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { copilotAPIKey, intuitBaseUrl } from '@/config'
import { API_DOMAIN } from '@/constant/domains'
import { PortalImpactVerification } from '@/db/schema/portalImpactVerification'
import {
  QBPortalConnection,
  QBPortalConnectionSelectSchemaType,
  QBPortalConnectionUpdateSchemaType,
} from '@/db/schema/qbPortalConnections'
import { getFetcher } from '@/helper/fetch.helper'
import { bottleneck } from '@/utils/bottleneck'
import Intuit from '@/utils/intuit'
import CustomLogger from '@/utils/logger'
import { captureMessage } from '@sentry/nextjs'
import dayjs from 'dayjs'
import { and, eq, inArray, ne, SQL } from 'drizzle-orm'
import httpStatus from 'http-status'

type InvoiceResponseType = {
  Id: string
  DocNumber: string
}

type processForPortalType = {
  portal: QBPortalConnectionSelectSchemaType
  propagateError?: boolean
  impactedPortal?: Record<string, string[]>
  failedPortal?: string[]
  failedPortalInAssembly?: string[]
}

export class PortalImpactVerificationService extends BaseService {
  async startProcess() {
    const portalConnections = await this.db.query.QBPortalConnection.findMany()
    const promises = []
    const impactedPortal: Record<string, string[]> = {}
    const failedPortal: string[] = []
    const failedPortalInAssembly: string[] = []

    for (const portal of portalConnections) {
      const asyncFn = bottleneck.schedule(() => {
        return this.processForPortal({
          portal,
          impactedPortal,
          failedPortal,
          failedPortalInAssembly,
        })
      })
      promises.push(asyncFn)
    }
    await Promise.all(promises)

    CustomLogger.info({
      message: 'Overall report',
      obj: { impactedPortal },
    })

    console.info('Impacted portals: ', JSON.stringify(impactedPortal))
    console.info('Failed portals: ', JSON.stringify(failedPortal))
    console.info(
      'Failed portals in Assembly: ',
      JSON.stringify(failedPortalInAssembly),
    )
  }

  private async processForPortal({
    portal,
    impactedPortal,
    failedPortal,
    failedPortalInAssembly,
    propagateError = false,
  }: processForPortalType) {
    const portalId = portal.portalId
    try {
      // 1. get all invoices from assembly for the portal
      const portalInvoiceNumberList = await this.getPortalInvoicesFromAssembly(
        portalId,
        failedPortalInAssembly,
      )

      if (portalInvoiceNumberList.length === 0) {
        console.info(
          '\n\n No invoice found for portal: ' + portalId + ' Skipping.. \n\n',
        )
        return
      }

      // 2. get all synced invoices for the portal in QB
      const accessToken = await this.getRefreshedAccessToken(
        portal,
        failedPortal,
      )
      if (!accessToken) {
        console.error('No access token for portal: ' + portal.portalId)
        return
      }

      const qbInvoices = await this.getInvoiceFromQB(
        portal,
        accessToken,
        failedPortal,
      )

      if (!qbInvoices) {
        console.error(
          '\n\nNo invoices found for portal in QB: ' + portal.portalId,
        )
        return
      }

      // 3. diff two lists and get invoices only in QB
      const diffInvoiceNumber = qbInvoices
        .filter((invNumber) => !portalInvoiceNumberList.includes(invNumber))
        .filter((inv) => inv !== null || inv !== undefined || inv !== '')
      if (impactedPortal) impactedPortal[portalId] = diffInvoiceNumber

      CustomLogger.info({
        message: `Portal ${portalId} with impacted invoice list: `,
        obj: { invoices: diffInvoiceNumber },
      })
      console.info('\n\n##### Completed portal: ' + portalId)

      return diffInvoiceNumber
    } catch (error: unknown) {
      console.error(
        'portalImpactVerificationService#processForPortal :: Error processing portal',
        portalId,
      )
      if (propagateError) throw error
    }
  }

  private async getPortalInvoicesFromAssembly(
    portalId: string,
    failedPortalInAssembly?: string[],
  ) {
    try {
      console.info('Fetching portal invoices from Assembly')
      const url = `${API_DOMAIN}/v1/invoices?limit=${MAX_INVOICE_LIST_LIMIT.toString()}`
      const options = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'X-API-KEY': `${portalId}/${copilotAPIKey}`,
        },
      }
      const invoiceList = []
      let nextToken = null
      while (true) {
        const urlWithToken: string = `${url}${nextToken ? `&nextToken=${nextToken}` : ''}`

        console.info('Fetch URL: ' + urlWithToken + ' portal: ' + portalId)
        const resp = await fetch(urlWithToken, options)
        if (!resp.ok) {
          console.error(
            `Error fetching invoices from Assembly. ${portalId} ${resp.status} ${resp.statusText}`,
          )
          if (failedPortalInAssembly) failedPortalInAssembly.push(portalId)
          throw new APIError(
            resp.status,
            `Error fetching invoices from Assembly. ${portalId} ${resp.status} ${resp.statusText}`,
          )
        }

        const data = await resp.json()
        if (!data.data) break

        invoiceList.push(...data.data)
        if (!data.nextToken) break

        nextToken = data.nextToken
        console.info('Pagination token found. Fetching next page...')
      }
      return invoiceList.map((invoice) => invoice.number)
    } catch (error) {
      console.error(error)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'Error while getting invoices from Assembly',
      )
    }
  }

  private async getInvoiceFromQB(
    portal: QBPortalConnectionSelectSchemaType,
    accessToken: string,
    failedPortal?: string[],
  ) {
    console.info('Getting invoices from QB for portal ' + portal.portalId)
    try {
      const maxResults = '1000'
      let startPosition = 1
      const qbInvoices: string[] = []

      const txnDate = new Date(portal.createdAt)
      const result = txnDate.toISOString().split('T')[0]

      while (true) {
        const query = `select id, DocNumber from Invoice where DocNumber != '' and TxnDate > '${result}' maxresults ${maxResults} startPosition ${startPosition}`
        const url = `${intuitBaseUrl}/v3/company/${portal.intuitRealmId}/query?query=${encodeURIComponent(query)}&minorversion=75`

        console.info(`QB url: ${url}. Portal id: ${portal.portalId}`)

        const header = {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'content-type': 'application/json',
        }
        const res = await getFetcher(url, header)
        if (!res) {
          if (failedPortal) failedPortal.push(portal.portalId)
          throw new APIError(
            httpStatus.BAD_REQUEST,
            'PortalImpactVerificationService#getInoiceFromQB | No response from Intuit API',
          )
        }

        if (res?.Fault) {
          // CustomLogger.error({ obj: res.Fault?.Error, message: 'Error: ' })
          console.error(
            `Fault response for portal: ${portal.portalId}. ${res.Fault.Error?.code}`,
          )
          if (failedPortal) failedPortal.push(portal.portalId)
          throw new APIError(
            res.Fault.Error?.code || httpStatus.BAD_REQUEST,
            `PortalImpactVerificationService#getInoiceFromQB`,
            res.Fault?.Error,
          )
        }
        if (!res.QueryResponse || !res.QueryResponse.Invoice) break

        const ids = res.QueryResponse.Invoice?.map(
          (invoice: InvoiceResponseType) => invoice.DocNumber,
        ).filter(
          (invoiceNum: string) =>
            invoiceNum !== null || invoiceNum !== undefined,
        )
        qbInvoices.push(...ids)

        console.info(
          `\n\n Max invoice count for portal: ${portal.portalId} is ${res.QueryResponse.maxResults} \n\n`,
        )

        if (res.QueryResponse.maxResults < maxResults) {
          break
        }
        startPosition = startPosition + 1
      }
      return qbInvoices
    } catch (error: unknown) {
      console.error(error)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'Error while getting invoices from QB for portalId',
      )
    }
  }

  private async getRefreshedAccessToken(
    portal: QBPortalConnectionSelectSchemaType,
    failedPortal?: string[],
  ) {
    try {
      const tokenInfo = await Intuit.getInstance().getRefreshedQBToken(
        portal.refreshToken,
      )

      const updatedPayload: QBPortalConnectionUpdateSchemaType = {
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        expiresIn: tokenInfo.expires_in,
        XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
        tokenSetTime: dayjs().toDate(),
      }

      const whereConditions = and(
        eq(QBPortalConnection.intuitRealmId, portal.intuitRealmId),
        eq(QBPortalConnection.portalId, portal.portalId),
      ) as SQL

      const tokenService = new TokenService(this.user)
      await tokenService.updateQBPortalConnection(
        updatedPayload,
        whereConditions,
        ['id'],
      )
      console.info('Access token refreshed and updated in DB 🔥')
      return tokenInfo.access_token
    } catch (error: unknown) {
      if (failedPortal) failedPortal.push(portal.portalId)

      console.error(error)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'Error while refreshing token for portal' + portal.portalId,
      )
    }
  }

  async checkImpactedInvoiceForPortal(
    portal: QBPortalConnectionSelectSchemaType,
  ) {
    try {
      const portalId = portal.portalId
      const impactedPortal = await this.getUnverifiedByPortalId(portalId)

      if (!impactedPortal) {
        console.info(`Not an impacted portal: ${portalId}. Skipping..`)
        return
      }

      const invoiceNumbers = await this.processForPortal({
        portal,
        propagateError: true,
      })
      if (!invoiceNumbers || invoiceNumbers.length === 0) {
        console.info(
          `No invoice number difference found for portal: ${portalId}.`,
        )
        // if no difference found, mark the portal impact verification as verified
        await this.markPortalImpactVerified(portalId)
        return
      }

      const syncLogs = await this.getLogsNotInPortal(portalId, invoiceNumbers)
      if (syncLogs.length > 0) {
        // report to sentry if incorrect invoices in QB are synced through our app
        captureMessage(
          `Portal ${portalId} has incorrect invoice created in their QBO account`,
          {
            tags: {
              key: 'incorrectlyCreatedInvoices', // can be used to search like "key:incorrectlyCreatedInvoices"
            },
            extra: {
              details: syncLogs,
            },
            level: 'error',
          },
        )
        return
      }
      await this.markPortalImpactVerified(portalId)
    } catch (error: unknown) {
      if (error instanceof APIError) {
        CustomLogger.error({ obj: error, message: error.message })
      } else {
        console.error(error)
      }

      // report to sentry if any errors
      captureMessage(
        `PortalImpactVerificationService#checkImpactedInvoiceForPortal :: Error fetching invoices from Assembly. ${portal.portalId}`,
        {
          tags: {
            key: 'portalImpact', // can be used to search like "key:portalImpact"
          },
          extra: {
            portalId: portal.portalId,
            error,
          },
          level: 'error',
        },
      )
    }
  }

  async markPortalImpactVerified(portalId: string) {
    console.info(
      'PortalImpactVerificationService#markPortalImpactVerified :: Marking portal impact verification as verified',
    )
    await this.db
      .update(PortalImpactVerification)
      .set({
        isVerified: true,
      })
      .where(eq(PortalImpactVerification.portalId, portalId))

    console.info(
      `PortalImpactVerificationService#markPortalImpactVerified :: Portal ${portalId} marked as verified`,
    )
  }

  async getUnverifiedByPortalId(portalId: string) {
    return await this.db.query.PortalImpactVerification.findFirst({
      where: (PortalImpactVerification, { eq, and }) =>
        and(
          eq(PortalImpactVerification.portalId, portalId),
          eq(PortalImpactVerification.isVerified, false),
        ),
    })
  }

  async getLogsNotInPortal(portalId: string, invoiceNumbers: string[]) {
    const logs = await this.db.query.QBSyncLog.findMany({
      where: (logs) =>
        and(
          inArray(logs.invoiceNumber, invoiceNumbers),
          ne(logs.portalId, portalId),
        ),
      columns: {
        portalId: true,
        invoiceNumber: true,
        copilotId: true,
      },
    })
    console.info(
      `Result of syncLogs based on above invoice number list: ${JSON.stringify(logs)}`,
    )
    return logs
  }
}
