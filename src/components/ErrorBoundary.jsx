import { Component } from 'react'

// 화면에 예상 못 한 오류가 나도 빈(검은) 화면 대신 안내와 다시 시도 버튼을 보여준다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(error, info)
  }

  componentDidUpdate(prevProps) {
    // 다른 화면으로 이동하면 오류 상태를 풀어준다.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="screen">
        <h1>⚠️ 화면을 여는 중에 문제가 생겼어요</h1>
        <p className="subtitle">잠시 후 다시 시도해 주세요. 계속 같은 화면에서 생기면 이 문구를 캡처해서 알려주세요.</p>
        <p className="hint">{String(this.state.error?.message ?? this.state.error)}</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          다시 불러오기
        </button>
        <button type="button" className="btn-secondary" onClick={() => (window.location.href = '/menu')}>
          메인 메뉴로
        </button>
      </div>
    )
  }
}
