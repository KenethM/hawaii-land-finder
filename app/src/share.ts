// Shareable links: #lot=<TMK> opens a lot; #lot=<TMK>&plan=<data> also opens its plan.
// The plan travels inside the link itself, so no server or account is needed.
import type { Plan } from './sandbox/plan'

const toB64Url = (bytes: Uint8Array) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function lotLink(tmk: string, plan?: Plan) {
  const base = `${location.origin}${location.pathname}#lot=${encodeURIComponent(tmk)}`
  if (!plan) return base
  return `${base}&plan=${toB64Url(new TextEncoder().encode(JSON.stringify(plan)))}`
}

export function readLink(): { tmk: string; plan: Plan | null } | null {
  const params = new URLSearchParams(location.hash.slice(1))
  const tmk = params.get('lot')
  if (!tmk) return null
  let plan: Plan | null = null
  const raw = params.get('plan')
  if (raw) {
    try {
      const p = JSON.parse(new TextDecoder().decode(fromB64Url(raw))) as Plan
      if (p?.v === 1 && Array.isArray(p.shapes)) plan = p
    } catch {
      // damaged link: open the lot without the plan
    }
  }
  return { tmk, plan }
}

export function clearLink() {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}

/** Share sheet on phones, clipboard elsewhere. Resolves to how it was shared. */
export async function shareUrl(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ url, title })
      return 'shared'
    }
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
