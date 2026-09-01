import Anthropic from '@anthropic-ai/sdk'

let client

export function getClient() {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

// 529(과부하)/503/502/429는 잠시 후 재시도하면 대부분 성공하는 일시적 오류라 자동으로 재시도한다.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529])

function friendlyErrorMessage(err) {
  const status = err?.status
  if (status === 529 || status === 503) {
    return '지금 AI 서버가 많이 붐빕니다. 잠시 후 다시 시도해주세요.'
  }
  if (status === 429) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
  }
  if (status === 401 || status === 403) {
    return 'API 키 설정에 문제가 있습니다. 관리자에게 문의해주세요.'
  }
  return err?.message || '분석 중 오류가 발생했습니다.'
}

export async function parseWithRetry(params, { retries = 2, baseDelayMs = 1000 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getClient().messages.parse(params)
    } catch (err) {
      lastErr = err
      if (attempt < retries && RETRYABLE_STATUSES.has(err?.status)) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)))
        continue
      }
      throw new Error(friendlyErrorMessage(err))
    }
  }
  throw new Error(friendlyErrorMessage(lastErr))
}
