import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

let client

function getClient() {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

export async function suggestIngredientMatches({ ingredientName, candidateItems }) {
  if (!candidateItems || candidateItems.length === 0) {
    return { suggestions: [] }
  }

  // z.enum(candidateItems)로 제약해서, 모델이 목록에 없는 물품명을 지어내지 못하게 한다.
  const MatchSchema = z.object({
    suggestions: z
      .array(z.enum(candidateItems))
      .max(5)
      .describe('입고 물품명 목록 중에서만 고른, 관련성 높은 순서의 후보 (최대 5개)'),
  })

  const prompt = `한 식당의 레시피 재료명과 입고 내역 물품명입니다. 표현은 달라도 실제로 같은 재료를 가리키는 경우가 많습니다 (예: "돼지고기" ↔ "국내산 돼지 앞다리살").

레시피 재료명: "${ingredientName}"

입고 물품명 목록:
${candidateItems.map((name) => `- ${name}`).join('\n')}

위 물품명 목록 중에서만 골라 이 재료명과 같은 재료일 가능성이 높은 순서로 추천하세요. 목록에 없는 이름을 만들어내지 마세요. 확실한 후보가 없으면 빈 배열을 반환하세요.`

  const response = await getClient().messages.parse({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: {
      format: zodOutputFormat(MatchSchema),
      effort: 'low',
    },
    messages: [{ role: 'user', content: prompt }],
  })

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    return { suggestions: [] }
  }

  return response.parsed_output
}
