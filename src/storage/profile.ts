/**
 * The one piece of "who is this" state HACHIKO keeps - a first name and a
 * consent record, both localStorage only, never transmitted. This is the
 * entire identity system (CLAUDE.md: no accounts, no login).
 */
const KEY = 'hachiko.profile.v1'

export interface Profile {
  name: string
  guardianName: string
  consentedAt: number
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as Profile
  } catch {
    return null
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(profile))
}

/**
 * Removes only the stored profile key. The end screen's "Hapus profil"
 * action also clears session history via `deleteAllSessions()`; this
 * function stays single-purpose so the two storage domains stay decoupled.
 */
export function deleteProfile(): void {
  localStorage.removeItem(KEY)
}
