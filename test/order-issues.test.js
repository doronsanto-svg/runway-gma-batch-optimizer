import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrderIssues } from '../src/order-issues.js';

function baseOrder(overrides = {}) {
  return {
    id: 1,
    number: '#1',
    channel: { name: 'Runway by Christian Siriano' },
    customer: { full_name: 'Runway Customer', phone: '' },
    deliver_to: {
      first_name: 'Runway',
      last_name: 'Customer',
      address1: '123 Main St',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'US',
      phone: ''
    },
    tags: [],
    can_be_shipped: true,
    allocated_completely: true,
    ...overrides
  };
}

test('does not flag missing phone as an issue', () => {
  assert.equal(analyzeOrderIssues(baseOrder()), null);
});

test('does not flag Fraud low as an issue', () => {
  assert.equal(analyzeOrderIssues(baseOrder({
    tags: [{ name: 'Fraud (low)' }]
  })), null);
});

test('still flags stronger fraud tags', () => {
  const issue = analyzeOrderIssues(baseOrder({
    tags: [{ name: 'Fraud (medium)' }]
  }));

  assert.equal(issue.issue_types.includes('fraud'), true);
  assert.equal(issue.severity, 'hold');
});

test('still flags address verification issues', () => {
  const issue = analyzeOrderIssues(baseOrder({
    deliver_to: {
      address1: '123 Main St',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'US',
      validated: false,
      validation_message: 'Address requires review.'
    }
  }));

  assert.equal(issue.issue_types.includes('address'), true);
});

test('flags address review tags as hold issues', () => {
  const issue = analyzeOrderIssues(baseOrder({
    tags: [{ name: 'Address Review' }]
  }));

  assert.equal(issue.issue_types.includes('address'), true);
  assert.equal(issue.severity, 'hold');
});

test('flags generic hold tags as hold issues', () => {
  const issue = analyzeOrderIssues(baseOrder({
    tags: [{ name: 'Hold' }]
  }));

  assert.equal(issue.issue_types.includes('shipping'), true);
  assert.equal(issue.severity, 'hold');
  assert.equal(issue.hold, true);
});
