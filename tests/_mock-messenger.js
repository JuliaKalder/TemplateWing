/**
 * Minimal in-memory stub of the Thunderbird `messenger.*` surface used by
 * modules under test. Install with `installMessengerMock()` from a test's
 * `before` hook (or at the top of the file) and reset with
 * `resetMessengerMock()` in `beforeEach`.
 */

export function createMessengerMock() {
  const store = {};
  const listeners = [];

  const compose = {
    _details: {},
    async getComposeDetails(tabId) {
      return compose._details[tabId] ?? {};
    },
    async setComposeDetails(tabId, details) {
      compose._details[tabId] = { ...(compose._details[tabId] ?? {}), ...details };
    },
    async addAttachment(tabId, attachment) {
      const list = compose._details[tabId]?.attachments ?? [];
      list.push(attachment);
      compose._details[tabId] = { ...(compose._details[tabId] ?? {}), attachments: list };
    },
  };

  return {
    storage: {
      local: {
        async get(defaults) {
          if (typeof defaults === "string") {
            return { [defaults]: store[defaults] };
          }
          const result = {};
          for (const [key, fallback] of Object.entries(defaults ?? {})) {
            result[key] = Object.prototype.hasOwnProperty.call(store, key)
              ? store[key]
              : fallback;
          }
          return result;
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const listener of listeners) {
            listener(changes, "local");
          }
        },
        async remove(keys) {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const key of arr) delete store[key];
        },
        _raw: store,
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        },
      },
    },
    identities: {
      async get(id) { return this._index?.[id] ?? null; },
      _index: {},
    },
    accounts: {
      _list: [],
      async list() { return this._list; },
    },
    compose,
    i18n: {
      getMessage(key, substitutions) {
        if (!substitutions) return `[${key}]`;
        return `[${key}:${[].concat(substitutions).join(",")}]`;
      },
    },
  };
}

export function installMessengerMock() {
  globalThis.messenger = createMessengerMock();
  return globalThis.messenger;
}

export function uninstallMessengerMock() {
  delete globalThis.messenger;
}
