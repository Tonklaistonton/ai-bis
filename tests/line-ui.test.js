const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(fetch) {
  const notices = [];
  const context = vm.createContext({
    window: { App: { showToast: (...args) => notices.push(args) } },
    document: {}, console, fetch
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/lineSimulator.js'), 'utf8'), context);
  return { ui: context.window.LineSimulator, notices };
}

test('selected conversation excludes other customer bot messages', () => {
  const { ui } = setup();
  ui.chatContainer = {};
  ui.activeUserId = 'customer-a';
  ui.allChats = [
    { userId: 'customer-b', isBot: true, text: 'private' },
    { userId: 'customer-a', isBot: true, text: 'reply' },
    { userId: 'customer-a', isBot: false, text: 'question' }
  ];
  const shown = [];
  ui.addAdminMessage = text => shown.push(text);
  ui.addCustomerMessage = text => shown.push(text);
  ui.scrollToBottom = () => {};
  ui.renderCurrentMessages();
  assert.deepEqual(shown, ['question', 'reply']);
});

test('no selected customer never dispatches', async () => {
  let calls = 0;
  const { ui } = setup(async () => { calls++; });
  ui.inputBox = { value: 'hello' };
  await ui.handleSendMessage();
  assert.equal(calls, 0);
  assert.equal(ui.inputBox.value, 'hello');
});

test('failed dispatch retains text and unlocks send button', async () => {
  const { ui, notices } = setup(async () => ({ ok: false, json: async () => ({ error: 'failed' }) }));
  ui.inputBox = { value: 'hello' };
  ui.sendBtn = { disabled: false };
  ui.activeUserId = 'customer-a';
  ui.allChats = [{ userId: 'customer-a', isBot: false }];
  await ui.handleSendMessage();
  assert.equal(ui.inputBox.value, 'hello');
  assert.equal(ui.sendBtn.disabled, false);
  assert.equal(ui.sending, false);
  assert.equal(notices.at(-1)[1], 'error');
});

test('successful dispatch clears only original draft', async () => {
  const { ui } = setup(async () => ({ ok: true, json: async () => ({ delivered: true }) }));
  ui.inputBox = { value: 'hello' };
  ui.sendBtn = { disabled: false };
  ui.activeUserId = 'customer-a';
  ui.allChats = [{ userId: 'customer-a', isBot: false }];
  ui.loadMessagesFromServer = async () => {};
  await ui.handleSendMessage();
  assert.equal(ui.inputBox.value, '');
  assert.equal(ui.sendBtn.disabled, false);
});

test('message escaping renders external markup as text', () => {
  const { ui } = setup();
  assert.equal(ui.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});
