/**
 * Teams, team-scoped channels, strict chat ownership, and the AI handoff rule.
 * Runs against a throwaway SQLite file so it never touches data/aizen.db.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'aizen-teams-')),
  'test.db'
);
process.env.DB_FILE = tmpFile;

const db = require('../lib/db');
const auth = require('../lib/auth');

test.after(() => {
  db.close();
  fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
});

test('teams and multi-team membership', () => {
  const a = db.createTeam('ทีมขาย');
  const b = db.createTeam('ทีมบริการลูกค้า');
  assert.ok(a.team.id && b.team.id);
  assert.match(db.createTeam('ทีมขาย').error, /ถูกใช้แล้ว/);

  const alice = auth.createUser('alice', 'password1').user;
  const bob = auth.createUser('bob', 'password2').user;
  db.addUserToTeam(a.team.id, alice.id);
  db.addUserToTeam(b.team.id, alice.id);
  db.addUserToTeam(a.team.id, bob.id);

  // One user, many teams.
  assert.deepStrictEqual(
    db.getUserTeams(alice.id).map((t) => t.name),
    ['ทีมขาย', 'ทีมบริการลูกค้า']
  );
  assert.ok(db.getUserTeams(bob.id).length === 1);
  assert.ok(auth.isTeamMember(alice, a.team.id));
  assert.ok(!auth.isTeamMember(bob, b.team.id));
});

test('staff only see channels of their own teams', () => {
  const alice = auth.getUserByUsername('alice');
  const bob = auth.getUserByUsername('bob');
  const [teamA, teamB] = db.listTeams();

  db.createChannel({ teamId: teamA.id, type: 'line', name: 'LINE ฝ่ายขาย' });
  db.createChannel({ teamId: teamB.id, type: 'line', name: 'LINE ฝ่ายบริการ' });

  assert.strictEqual(db.getChannelsForUser(bob).length, 1);
  assert.strictEqual(db.getChannelsForUser(alice).length, 2);
  // Admin sees everything.
  const admin = auth.createUser('root', 'password3', 'admin').user;
  assert.strictEqual(db.getChannelsForUser(admin).length, 2);
});

test('claiming is first-come, release frees the room for AI again', () => {
  const alice = auth.getUserByUsername('alice');
  const bob = auth.getUserByUsername('bob');
  const channel = db.listChannels()[0];
  const conversation = db.ensureConversation(channel.id, 'U_customer1', 'ลูกค้า A');

  // Unassigned: nobody owns it yet, so it is open to everyone in the team.
  assert.strictEqual(conversation.assignedUserId, null);

  const claimed = db.claimConversation(conversation.id, alice.id);
  assert.strictEqual(claimed.conversation.assignedUserId, alice.id);

  // Second staff member is refused.
  const clash = db.claimConversation(conversation.id, bob.id);
  assert.match(clash.error, /รับผิดชอบอยู่แล้ว/);
  assert.strictEqual(clash.takenBy, alice.id);

  // Strict ownership on send.
  assert.ok(auth.canReplyToConversation(alice, db.getConversation(conversation.id)));
  assert.ok(!auth.canReplyToConversation(bob, db.getConversation(conversation.id)));
  const admin = auth.getUserByUsername('root');
  assert.ok(auth.canReplyToConversation(admin, db.getConversation(conversation.id)));

  // Bob cannot release Alice's room.
  assert.match(db.releaseConversation(conversation.id, bob.id, false).error, /ไม่ใช่เจ้าของ/);
  // Alice can; afterwards the room is unassigned again so AI resumes.
  const released = db.releaseConversation(conversation.id, alice.id, false);
  assert.strictEqual(released.conversation.assignedUserId, null);
});

test('conversation listing is scoped to the given channels', () => {
  const channels = db.listChannels();
  const alice = auth.getUserByUsername('alice');
  const bob = auth.getUserByUsername('bob');

  const bobChannels = db.getChannelsForUser(bob).map((c) => c.id);
  const listed = db.getConversationsForChannels(bobChannels);
  assert.ok(listed.every((c) => bobChannels.includes(c.channelId)));

  // A staff member querying another team's channel gets nothing.
  assert.deepStrictEqual(
    db.getConversationsForChannels(channels.filter((c) => !bobChannels.includes(c.id)).map((c) => c.id)),
    []
  );
  assert.ok(alice);
});

test('messages carry their channel and conversation', () => {
  const channel = db.listChannels()[0];
  const conversationId = db.conversationId(channel.id, 'U_customer2');
  const msg = db.addLineMessage({
    userId: 'U_customer2',
    text: 'สวัสดี',
    status: 'received',
    channelId: channel.id,
    conversationId
  });
  const stored = db.getLineChats(10).find((m) => m.id === msg.id);
  assert.strictEqual(stored.channelId, channel.id);
  assert.strictEqual(stored.conversationId, conversationId);
});