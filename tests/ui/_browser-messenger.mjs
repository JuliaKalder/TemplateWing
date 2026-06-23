/**
 * Init-script injected by Playwright before every page load.
 *
 * Mirrors the WebExtension `messenger.*` surface that popup/options/etc.
 * touch at module-load time. Pure ES module string returned from the
 * exported builder, because Playwright's `addInitScript({ content })`
 * runs in the page context, not as a module.
 *
 * Keep this in sync with tests/_mock-messenger.js (the Node test stub):
 * any new top-level namespace popup/options touches must be added here too.
 */

export const messengerStubSource = `
(() => {
  if (window.messenger) return;
  const store = {};
  const changeListeners = [];
  const tabs = [{ id: 1, type: "messageCompose", windowId: 1 }];

  const composeDetails = { 1: { identityId: "id-1", isPlainText: false, body: "" } };

  window.messenger = {
    storage: {
      local: {
        async get(defaults) {
          if (typeof defaults === "string") {
            return { [defaults]: store[defaults] };
          }
          const result = {};
          for (const [key, fallback] of Object.entries(defaults || {})) {
            result[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
          }
          return result;
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const fn of changeListeners) fn(changes, "local");
        },
        async remove(keys) {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const key of arr) delete store[key];
        },
        _raw: store,
      },
      onChanged: {
        addListener(fn) { changeListeners.push(fn); },
        removeListener(fn) {
          const i = changeListeners.indexOf(fn);
          if (i !== -1) changeListeners.splice(i, 1);
        },
      },
    },
    i18n: {
      getMessage(key, sub) {
        if (!sub) return key;
        return key + ":" + [].concat(sub).join(",");
      },
    },
    runtime: {
      onMessage: {
        addListener() {},
        removeListener() {},
      },
      async sendMessage() { return undefined; },
      getURL(p) { return "stub://" + p; },
      async openOptionsPage() {},
    },
    tabs: {
      async query() { return tabs.slice(); },
      onCreated: { addListener() {} },
      async sendMessage() { return { ok: true }; },
      async executeScript() {},
    },
    compose: {
      async getComposeDetails(id) { return composeDetails[id] || { identityId: null, body: "" }; },
      async setComposeDetails(id, details) {
        composeDetails[id] = { ...(composeDetails[id] || {}), ...details };
        // Record for tests via window.__lastSetComposeDetails.
        window.__lastSetComposeDetails = { tabId: id, details: { ...details } };
      },
      async addAttachment() {},
    },
    accounts: {
      async list() {
        return [
          { id: "acc-1", name: "Personal", identities: [{ id: "id-1", email: "me@example.com", name: "Me" }] },
        ];
      },
    },
    identities: {
      async get(id) {
        const list = [{ id: "id-1", email: "me@example.com", name: "Me" }];
        return list.find((i) => i.id === id) || null;
      },
    },
    windows: {
      async create() { return { id: 99 }; },
      async getAll() { return [{ id: 1, type: "normal" }]; },
      async update() {},
      onRemoved: { addListener() {}, removeListener() {} },
    },
    notifications: {
      async create() {},
    },
    messages: {
      async get() { return null; },
      async getFull() { return null; },
    },
    composeScripts: { async register() {} },
    menus: {
      create() {}, async removeAll() {}, refresh() {},
      onClicked: { addListener() {} }, onShown: { addListener() {} },
    },
    commands: { onCommand: { addListener() {} } },
  };
})();
`;
