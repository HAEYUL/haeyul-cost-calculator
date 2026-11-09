import { describe, it, expect } from 'vitest'
import { searchItemNames } from './itemSearch'

const names = ['대파', '쪽파', '염장연근채(중국산/진공/1kg*10)box', '연근', 'Green Onion', '국산 대파 1kg']

describe('searchItemNames', () => {
  it('중간 글자로도 찾는다', () => {
    expect(searchItemNames(names, '연근채')).toEqual(['염장연근채(중국산/진공/1kg*10)box'])
    expect(searchItemNames(names, '중국산')).toEqual(['염장연근채(중국산/진공/1kg*10)box'])
  })
  it('앞글자부터 맞는 이름을 먼저 보여준다', () => {
    expect(searchItemNames(names, '연근')).toEqual(['연근', '염장연근채(중국산/진공/1kg*10)box'])
    expect(searchItemNames(names, '대파')).toEqual(['대파', '국산 대파 1kg'])
  })
  it('띄어쓰기와 대소문자를 무시한다', () => {
    expect(searchItemNames(names, '염장 연근채')).toEqual(['염장연근채(중국산/진공/1kg*10)box'])
    expect(searchItemNames(names, 'green')).toEqual(['Green Onion'])
    expect(searchItemNames(names, '국산대파')).toEqual(['국산 대파 1kg'])
  })
  it('빈 검색어나 없는 물품은 빈 목록', () => {
    expect(searchItemNames(names, '  ')).toEqual([])
    expect(searchItemNames(names, '양파')).toEqual([])
  })
  it('개수 제한', () => {
    expect(searchItemNames(names, '파', 2)).toHaveLength(2)
  })
})
