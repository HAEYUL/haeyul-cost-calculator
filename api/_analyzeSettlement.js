import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { parseWithRetry } from './_anthropicClient.js'

const SettlementMonthSchema = z.object({
  year: z.number().describe('연도 (예: 2026). 표 제목이나 머리글에 적힌 연도를 그 아래 모든 월에 적용하세요.'),
  month: z.number().describe('월 (1~12 사이 정수)'),
  revenue: z.number().nullable().describe('총매출액(총 매출액) — 해당 월의 매출 합계'),
  ingredientCost: z.number().nullable().describe('총식재료비(총 식재료비)'),
  laborCost: z.number().nullable().describe('인건비 (표에 "인건비/매출"처럼 비율과 함께 있어도 금액만 추출)'),
  generalCost: z.number().nullable().describe('일반경비 (표에 "일반경비/매출"처럼 비율과 함께 있어도 금액만 추출)'),
  totalExpense: z.number().nullable().describe('지출총합계(지출 총 합계)'),
  operatingProfit: z.number().nullable().describe('영업손익'),
  pretaxProfit: z.number().nullable().describe('소득세차감전이익'),
})

const SettlementSchema = z.object({
  months: z
    .array(SettlementMonthSchema)
    .describe('표에 데이터가 채워진 개별 월만 포함하세요. 연간/누계 합계 열은 별도 항목으로 만들지 말고 제외하세요.'),
})

const PROMPT = `이 이미지는 한국 식당의 월별 운영결산표 사진입니다. 보통 이런 구조입니다:
- 맨 위에 매장명과 연도(예: "2026년도"), 그 옆에 연간 합계 열이 있고, 그 오른쪽으로 "1월", "2월", "3월"... 월별 열이 이어집니다.
- 각 월 열은 금액과 그 옆에 매출 대비 비율(%)이 같이 적혀 있는 경우가 많습니다. 비율(%) 값은 무시하고 금액만 읽으세요.
- "총 매출액" 아래에 "1층", "2층"처럼 층별/구간별 매출 세부 행이 있을 수 있습니다. 이 세부 행들은 추출하지 말고 무시하세요.
- "총 매출액"이 표 중간에 구분선처럼 한 번 더 나올 수 있습니다(비용 항목들의 비율 기준선). 이것도 별도 항목으로 만들지 말고, 매출 행은 최초 1번만 값으로 사용하세요.

각 월(개별 월만, 연간 합계 열은 제외)에서 다음 7개 금액을 추출하세요:
- 총매출액 (총 매출액)
- 총식재료비 (총 식재료비)
- 인건비 (표에는 "인건비/매출"처럼 적혀 있을 수 있음 — 금액만)
- 일반경비 (표에는 "일반경비/매출"처럼 적혀 있을 수 있음 — 금액만)
- 지출총합계 (지출 총 합계)
- 영업손익
- 소득세차감전이익

규칙:
- 숫자에서 쉼표(,)와 원(₩) 기호, %는 제거하고 숫자만 반환하세요. 음수는 앞에 "-" 표시나 빨간 글씨, 괄호 등으로 나타날 수 있으니 음수로 정확히 반환하세요.
- 데이터가 비어있거나 아직 채워지지 않은 미래 월(예: 아직 지나지 않은 달)은 결과에 포함하지 마세요.
- 어떤 항목의 값을 표에서 읽을 수 없으면 null로 두고, 추측해서 만들어내지 마세요.
- 연도는 표 제목에 한 번만 적혀 있어도 모든 월에 같은 연도를 적용하세요.`

export async function analyzeSettlementImage({ base64, mediaType }) {
  const response = await parseWithRetry({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: zodOutputFormat(SettlementSchema),
      effort: 'medium',
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('이미지 분석이 거부되었습니다. 다른 사진으로 다시 시도해주세요.')
  }

  if (!response.parsed_output) {
    throw new Error('결산표에서 정보를 추출하지 못했습니다. 사진을 더 선명하게 찍어 다시 시도해주세요.')
  }

  return response.parsed_output
}
