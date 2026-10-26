import { useEffect, useState } from 'react'
import { isHealthKitClient } from './healthkit.js'

// Platform detection must not depend on Health permissions or plugin status.
export function useHealthKitClient() {
  const [native, setNative] = useState(null)
  useEffect(() => {
    let alive = true
    isHealthKitClient().then(value => { if (alive) setNative(value) })
    return () => { alive = false }
  }, [])
  return native
}
