const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowsDir = path.join(__dirname, '..', 'n8n', 'workflows');
const workflows = fs.readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(fs.readFileSync(path.join(workflowsDir, file), 'utf8')));

test('n8n webhook templates require header authentication', () => {
  const webhookNodes = workflows.flatMap((workflow) =>
    workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook'),
  );

  assert.equal(webhookNodes.length, 2);
  for (const node of webhookNodes) {
    assert.equal(node.parameters.authentication, 'headerAuth');
    assert.equal(node.parameters.responseMode, 'responseNode');
  }
});

test('book search binds and bounds request input instead of interpolating SQL', () => {
  const workflow = workflows.find((entry) => entry.name === 'Library Search Books');
  const queryNode = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.postgres');

  assert.match(queryNode.parameters.query, /\$1/);
  assert.doesNotMatch(queryNode.parameters.query, /\{\{\s*\$json/);
  assert.match(queryNode.parameters.options.queryReplacement, /slice\(0,\s*200\)/);
});

test('scheduled workflow queries are read-only', () => {
  const scheduledWorkflows = workflows.filter((workflow) =>
    workflow.nodes.some((node) => node.type === 'n8n-nodes-base.scheduleTrigger'),
  );

  assert.equal(scheduledWorkflows.length, 2);
  for (const workflow of scheduledWorkflows) {
    const queryNode = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.postgres');
    assert.match(queryNode.parameters.query.trim(), /^SELECT\b/i);
  }
});

test('due and overdue workflows route formatted reminders to an email node', () => {
  for (const name of ['Library Due Reminder', 'Library Overdue Check']) {
    const workflow = workflows.find((entry) => entry.name === name);
    const emailNode = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.emailSend');

    assert.ok(emailNode, `${name} should include an email send node`);
    assert.match(emailNode.parameters.toEmail, /\$json\.email/);
    assert.match(emailNode.parameters.text, /\$json\.message/);
    assert.ok(emailNode.parameters.fromEmail);
  }
});
