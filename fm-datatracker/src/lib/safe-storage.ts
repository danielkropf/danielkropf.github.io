export const safeStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem(key) { try { return localStorage.getItem(key) } catch { return null } },
  setItem(key, value) { try { localStorage.setItem(key, value) } catch { /* optional preference */ } },
  removeItem(key) { try { localStorage.removeItem(key) } catch { /* optional preference */ } },
}

export const safeSessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem(key) { try { return sessionStorage.getItem(key) } catch { return null } },
  setItem(key, value) { try { sessionStorage.setItem(key, value) } catch { /* optional status */ } },
  removeItem(key) { try { sessionStorage.removeItem(key) } catch { /* optional status */ } },
}
