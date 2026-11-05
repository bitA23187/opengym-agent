import { useEffect, useState } from 'react'
import { nutritionToday } from './nutrition.js'

// Refresh an open app at 05:00 and after returning from the background.
export function useNutritionToday() {
  const [today, setToday] = useState(nutritionToday)
  useEffect(() => {
    let timer
    const refresh = () => {
      clearTimeout(timer)
      setToday(nutritionToday())
      const now = new Date(), next = new Date(now)
      next.setHours(5, 0, 0, 0)
      if (next <= now) next.setDate(next.getDate() + 1)
      timer = setTimeout(refresh, next - now)
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return today
}
