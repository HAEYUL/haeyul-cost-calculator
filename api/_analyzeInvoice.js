import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { parseWithRetry } from './_anthropicClient.js'

const InvoiceSchema = z.object({
  vendor: z.string().nullable().describe('거래처명(공급자명)'),
  date: z.string().nullable().describe('입고일. YYYY-MM-DD 형식, 연도를 알 수 없으면 null'),
  statementBalance: z
    .number()
    .nullable()
    .describe(
      '명세표에 "현잔액", "현잔고", "총잔금", "잔액"처럼 이번 거래까지 포함해 거래처에 갚아야 할 총액으로 적힌 값. ' +
        '"전잔금"(이전 미수금)과 "합계"/"당일합계"(이번 거래 금액)가 따로 있고 최종 합계가 표에 있으면 그 최종 합계값을 반환하세요. ' +
        '이번 거래 금액(공급가액, 당일합계)만 있고 누적 잔액을 나타내는 값이 표에 없으면 null.',
    ),
  items: z
    .array(
      z.object({
        name: z.string().describe('물품명'),
        quantity: z.number().nullable().describe('수량'),
        unitPrice: z.number().nullable().describe('단가(원)'),
        unit: z
          .enum(['g', 'kg', 'ea', 'other'])
          .nullable()
          .describe('단가가 무엇을 기준으로 매겨졌는지. g=그램당, kg=킬로그램당, ea=개(마리/봉지 등 낱개)당, other=그 외. 알 수 없으면 null'),
        amount: z.number().nullable().describe('금액(원)'),
      }),
    )
    .describe('명세표에 적힌 각 품목 행'),
})

const PROMPT = `이 이미지는 한국 식당에 납품된 거래명세표(또는 세금계산서) 사진입니다.
인쇄된 정형 양식일 수도 있고 손으로 쓴 명세표일 수도 있습니다. 손글씨도 최대한 정확히 읽어주세요.

표에서 다음을 추출하세요:
- 거래처명(공급자 상호명)
- 날짜 (있다면 YYYY-MM-DD 형식으로, 연도가 불확실하면 null)
- 현잔액/현잔고/총잔금 (표 하단에 "전잔금 + 당일합계 = 합계(총잔금)" 형태로 있는 경우가 많습니다. 이번 거래까지 포함한 최종 누적 잔액을 찾으세요)
- 각 품목의: 물품명, 수량, 단가, 단위, 금액

규칙:
- 숫자에서 쉼표(,)와 원(₩) 기호는 제거하고 숫자만 반환하세요.
- 수량·단가·금액 중 읽을 수 없는 값은 null로 두세요. 단, 세 값 중 두 개를 정확히 읽었고 나머지 하나가 "수량 × 단가 = 금액" 관계로 명확히 계산되면 채워서 반환하세요.
- 단위(unit)는 단가가 무엇 기준인지를 나타냅니다. 예: "13,500원/kg"이면 kg, "돼지고기 1kg 13,500원"처럼 수량 단위가 kg면 kg, "계란 30개 12,000원"처럼 개수 기준이면 ea, 그램 기준이면 g. 명확하지 않으면 null로 두세요.
- 품목명은 원문 그대로 옮기되 불필요한 공백만 정리하세요.
- 표에 없는 값을 추측해서 만들어내지 마세요.`

export async function analyzeInvoiceImage({ base64, mediaType }) {
  const response = await parseWithRetry({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: zodOutputFormat(InvoiceSchema),
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
    throw new Error('명세표에서 정보를 추출하지 못했습니다. 사진을 더 선명하게 찍어 다시 시도해주세요.')
  }

  return response.parsed_output
}
