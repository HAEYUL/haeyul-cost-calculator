import { useEffect, useState } from 'react'

// 크롬/안드로이드는 브라우저가 "beforeinstallprompt" 이벤트를 보내주면 그걸 잡아뒀다가
// 버튼을 눌렀을 때 네이티브 설치창을 띄울 수 있다. 사파리(아이폰)는 이 이벤트 자체가
// 없어서 대신 "공유 → 홈 화면에 추가" 방법을 안내하는 수밖에 없다.
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    setIsStandalone(standalone)

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    const handleInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !window.MSStream

  const promptInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return {
    isStandalone,
    isIOS,
    canPromptInstall: Boolean(deferredPrompt),
    promptInstall,
  }
}
