class SessionStore {
  constructor() {
    this._sessions = new Set();
  }

  createToken() {
    // Non-cryptographic token, consistent with previous behavior.
    // If you want stronger security later, swap to crypto.randomBytes.
    const token = Math.random().toString(36).slice(2);
    this._sessions.add(token);
    return token;
  }

  has(token) {
    return this._sessions.has(token);
  }

  delete(token) {
    this._sessions.delete(token);
  }

  clear() {
    this._sessions.clear();
  }
}

module.exports = { SessionStore };