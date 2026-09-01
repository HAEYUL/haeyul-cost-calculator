import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { parseWithRetry } from './_anthropicClient.js'

const RecipeSchema = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().describe('재료명'),
        amountG: z.number().nullable().describe('사용량. 그램(g)으로 확실히 환산 가능한 경우만 숫자로, 그렇지 않으면 null'),
        originalText: z.string().nullable().describe('원본에 적힌 수량 표현 그대로 (예: "2큰술", "1개", "200g")'),
      }),
    )
    .describe('레시피에 적힌 재료 목록'),
})

const PROMPT = `이 이미지는 한식당 메뉴의 레시피(재료 배합비) 사진입니다.
인쇄물일 수도 있고 손으로 쓴 메모일 수도 있습니다. 손글씨도 최대한 정확히 읽어주세요.

사진에서 재료명과 사용량을 모두 추출하세요.

규칙:
- 사용량은 항상 그램(g) 단위 숫자로 반환하는 것이 목표입니다. kg 단위는 1000을 곱해 g으로 환산하세요.
- "1개", "2큰술", "약간", "한 컵"처럼 무게가 아닌 단위이거나 재료 밀도를 몰라 g으로 정확히 환산할 수 없는 경우, amountG는 null로 두고 originalText에 원본 표현을 그대로 남기세요.
- 이미 g 단위로 적혀 있으면 숫자만 amountG에 반환하고 originalText에도 원본 그대로 남기세요.
- 표에 없는 재료를 추측해서 만들어내지 마세요.`

export async function analyzeRecipeImage({ base64, mediaType }) {
  const response = await parseWithRetry({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: zodOutputFormat(RecipeSchema),
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
    throw new Error('레시피에서 정보를 추출하지 못했습니다. 사진을 더 선명하게 찍어 다시 시도해주세요.')
  }

  return response.parsed_output
}
