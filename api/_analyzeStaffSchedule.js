import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { parseWithRetry } from './_anthropicClient.js'

const MarkSchema = z.enum(['O', '△', 'X'])

const DayEntrySchema = z.object({
  day: z.number().describe('날짜 (1~31 사이 정수)'),
  mark: MarkSchema.describe('그 날짜에 표시된 기호. 동그라미(종일근무)=O, 삼각형(반타임)=△, 엑스(휴무)=X'),
})

const EmployeeScheduleSchema = z.object({
  name: z.string().describe('근무자 성함'),
  entries: z
    .array(DayEntrySchema)
    .describe('이 사람의 표시가 있는 날짜만 포함하세요. 표시가 비어있거나 흐려서 알아볼 수 없는 날짜는 포함하지 마세요.'),
})

const StaffScheduleSchema = z.object({
  year: z.number().nullable().describe('근무표에 연도가 적혀 있으면 그 값, 적혀 있지 않으면 null'),
  month: z.number().describe('근무표에 적힌 월 (1~12 사이 정수)'),
  employees: z.array(EmployeeScheduleSchema).describe('표에 있는 모든 근무자'),
})

const PROMPT = `이 이미지는 한국 식당의 직원 근무표 사진입니다. 보통 이런 구조입니다:
- 세로 또는 가로로 직원 이름들이 나열되어 있고, 그 옆(또는 아래)으로 그 달의 날짜(1일, 2일, ...)별 칸이 이어집니다.
- 각 날짜 칸에는 동그라미(O), 삼각형(△), 엑스(X) 중 하나가 손글씨나 표시로 그려져 있습니다.
  - 동그라미(O) = 종일근무
  - 삼각형(△) = 반타임(반나절) 근무
  - 엑스(X) = 근무 없음(휴무)
- 표 제목이나 머리글에 "9월" "2026년 9월" 같은 연월 정보가 있습니다.

규칙:
- 각 직원마다, 표시를 읽을 수 있는 날짜만 day(날짜)와 mark(O/△/X)로 추출하세요.
- 칸이 비어있거나, 지워졌거나, 무슨 표시인지 확실히 알 수 없으면 그 날짜는 결과에 포함하지 마세요 (추측해서 만들어내지 마세요).
- 세모/삼각형 모양이면 반드시 △로, 동그라미 모양이면 O로, 엑스/가위표 모양이면 X로 반환하세요.
- 연도가 표에 안 보이면 year는 null로 두세요.
- 표에 있는 모든 직원을 빠짐없이 포함하세요.`

export async function analyzeStaffScheduleImage({ base64, mediaType }) {
  const response = await parseWithRetry({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      format: zodOutputFormat(StaffScheduleSchema),
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
    throw new Error('근무표에서 정보를 추출하지 못했습니다. 사진을 더 선명하게 찍어 다시 시도해주세요.')
  }

  return response.parsed_output
}
