import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalOrderNumber, isCbsOrder, orderMatchesEvent } from '../src/event.js';

test('CBS event matching normalizes leading punctuation, whitespace, and case', () => {
  for (const value of ['CBSD2440058-1', '#CBSD2440058-1', '  cbsd2440058-1 ', ' #cBsD2440058-1']) {
    assert.equal(isCbsOrder(value), true, value);
  }
  assert.equal(canonicalOrderNumber('  #cbsd2440058-1 '), 'CBSD2440058-1');
});

test('CBS event matching requires CBS in the first three normalized characters', () => {
  assert.equal(isCbsOrder('RUN-CBS-1001'), false);
  assert.equal(isCbsOrder('ACBS1001'), false);
  assert.equal(orderMatchesEvent({ number: '#CBS1001' }, 'cbs_deals'), true);
  assert.equal(orderMatchesEvent({ number: '#RUN1001' }, 'cbs_deals'), false);
});
