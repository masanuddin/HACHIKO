import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteProfile, loadProfile, saveProfile, type Profile } from './profile'
import { deleteAllSessions, listSessions, saveSession, type SessionRecord } from './sessions'

function profile(): Profile {
  return { name: 'Budi', guardianName: 'Ayah', consentedAt: 0 }
}

function session(id: string): SessionRecord {
  return {
    id,
    startedAt: 0,
    declaredMedia: ['laptop'],
    durationsMs: { FOKUS: 0, TERALIH: 0, TIDAK_HADIR: 0, UNCERTAIN: 0, MENGANTUK: 0 },
    distractionEvents: [],
    recoveryTimesMs: [],
    uncertainMs: 0,
    firstCollapseAtMs: null,
    clarification: null,
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe('profile storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('deleteProfile removes the profile', () => {
    saveProfile(profile())
    deleteProfile()
    expect(loadProfile()).toBeNull()
  })

  it('deleteProfile + deleteAllSessions leaves zero sessions and no profile', () => {
    saveProfile(profile())
    saveSession(session('a'))
    saveSession(session('b'))

    deleteProfile()
    deleteAllSessions()

    expect(loadProfile()).toBeNull()
    expect(listSessions()).toEqual([])
  })
})
