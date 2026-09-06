import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { parseWithRetry } from './_anthropicClient.js'
import { APP_GUIDE } from './_appGuide.js'

export async function askQuestion({ question }) {
  const AnswerSchema = z.object({
    answer: z.string().describe('질문에 대한 한국어 답변. 이해하기 쉽게, 필요하면 예시를 들어 설명한다.'),
  })

  const prompt = `당신은 식당 사장님이 쓰는 원가·재고 관리 앱의 사용법을 안내하는 도우미입니다. 아래는 이 앱의 화면과 계산 방식을 정리한 설명서입니다.

${APP_GUIDE}

위 설명서를 참고해서, 사장님의 질문에 이 앱 기준으로 정확하고 이해하기 쉽게 답하세요. 설명서에 없는 내용은 추측하지 말고, 모르면 모른다고 답하세요.

질문: "${question}"`

  const response = await parseWithRetry({
    model: 'claude-opus-5',
    max_tokens: 2048,
    output_config: {
      format: zodOutputFormat(AnswerSchema),
      effort: 'medium',
    },
    messages: [{ role: 'user', content: prompt }],
  })

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    return { answer: '답변을 만들지 못했습니다. 질문을 조금 다르게 다시 해보세요.' }
  }

  return response.parsed_output
}
