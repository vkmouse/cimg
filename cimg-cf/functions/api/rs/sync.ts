import type {
  Env,
  PutEntityHandler,
  PushCommand,
  PushResult,
  EntityType,
  SyncRequestBody,
  SyncResponseBody,
} from '../../types'
import * as userService from '../../services/userService'
import * as credentialService from '../../services/credentialService'
import * as bucketService from '../../services/bucketService'
import * as photoService from '../../services/photoService'
import * as photoBurstService from '../../services/photoBurstService'
import * as syncEventService from '../../services/syncEventService'
import { validateCommand, extractMutationId } from '../../services/syncCommandService'

/** entityType -> 對應的 Service.putXxx 方法（action 目前只有 PUT 一種，故不再需要 action 當 key 的一部分）。 */
const handlerMap: Record<EntityType, PutEntityHandler> = {
  USR: userService.put,
  CRD: credentialService.put,
  BKT: bucketService.put,
  PHT: photoService.put,
  PBT: photoBurstService.put,
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  let body: SyncRequestBody
  try {
    body = (await context.request.json()) as SyncRequestBody
  } catch {
    return Response.json({ error: 'Request body 必須是合法的 JSON' }, { status: 400 })
  }

  if (!body || !Array.isArray(body.pushCommands)) {
    return Response.json({ error: '缺少 pushCommands 陣列' }, { status: 400 })
  }
  if (typeof body.lastCursor !== 'number' || !Number.isInteger(body.lastCursor) || body.lastCursor < 0) {
    return Response.json({ error: 'lastCursor 必須是 >= 0 的整數' }, { status: 400 })
  }

  const { DB } = context.env
  // 本次請求帶來的所有 mutationId（不論驗證/寫入結果如何），pull 階段要排除，
  // 避免把發起者自己剛推上去的事件原封不動地回傳給它自己。
  const requestMutationIds: string[] = []

  // Pass 1：先驗證每個 command 的形狀，同時收集合法 command 的 mutationId，
  // 供下面的批次冪等性查詢使用。不合法的 command 直接產生 ERROR 結果，
  // 用陣列位置對應原本的 pushCommands 順序。
  type ValidatedEntry = { ok: true; command: PushCommand } | { ok: false; result: PushResult }

  const validated: ValidatedEntry[] = body.pushCommands.map((rawCommand) => {
    try {
      const command = validateCommand(rawCommand)
      requestMutationIds.push(command.mutationId)
      return { ok: true, command }
    } catch {
      return { ok: false, result: { mutationId: extractMutationId(rawCommand), status: 'ERROR' } }
    }
  })

  // 批次冪等性查詢：一次查完這批合法 command 裡哪些 mutationId 已經處理過，
  // 取代逐筆 SELECT，減少 DB round-trip。
  const duplicateMutationIds = await syncEventService.getDuplicateMutationIds(DB, requestMutationIds)

  // Pass 2：逐筆處理合法 command，冪等性判斷改用上面查好的 Set 同步比對，
  // 其餘行為（各自獨立驗證、獨立 try/catch、獨立成功/失敗）維持不變。
  const pushResults: PushResult[] = []

  for (const entry of validated) {
    if (!entry.ok) {
      pushResults.push(entry.result)
      continue
    }

    const command = entry.command

    try {
      // 冪等性檢查：這個 mutationId 已經處理過就直接跳過，不重複寫入。
      if (duplicateMutationIds.has(command.mutationId)) {
        pushResults.push({ mutationId: command.mutationId, status: 'SKIPPED' })
        continue
      }

      const handler = handlerMap[command.entityType]
      if (!handler) {
        pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
        continue
      }

      const result = await handler(DB, {
        entityId: command.entityId,
        baseVersion: command.baseVersion,
        mutationId: command.mutationId,
        payloadJson: command.payload,
      })

      // result === null：版本衝突、欄位沒有變化、或 INSERT 已存在，都視為 ERROR。
      pushResults.push({ mutationId: command.mutationId, status: result === null ? 'ERROR' : 'OK' })
    } catch {
      pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
    }
  }

  // Pull 階段：push 完成後，找出 lastCursor 之後的伺服器端新事件，
  // 並排除本次請求自己剛產生的 mutationId。
  const pullEvents = await syncEventService.getPullEvents(DB, body.lastCursor, requestMutationIds)

  const response: SyncResponseBody = {
    pushResults,
    newCursor: await syncEventService.getMaxId(DB),
    pullEvents,
  }
  return Response.json(response)
}
