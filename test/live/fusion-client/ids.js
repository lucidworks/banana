'use strict';

// Run identity and dashboard ids. Every id a live test uses comes from here.

const crypto = require('node:crypto');

// banana-it-<12 lowercase hexadecimal characters>-<counter from 1>, anchored.
const ID_PATTERN = /^banana-it-[0-9a-f]{12}-[1-9][0-9]{0,5}$/;
const HEX12 = /^[0-9a-f]{12}$/;

// A process identity: 12 hexadecimal characters from the system's random
// source, independent of a clock, a counter and every other identity.
function newIdentity() {
  return crypto.randomBytes(6).toString('hex');
}

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function isValidRunTag(tag) {
  return typeof tag === 'string' && HEX12.test(tag);
}

// Hands out banana-it-<identity>-<n> with n counting up from 1, never reused.
class Allocator {
  constructor(identity) {
    if (!HEX12.test(identity)) {
      throw new Error('identity must be 12 lowercase hexadecimal characters');
    }
    this.identity = identity;
    this._next = 1;
  }

  next() {
    const id = 'banana-it-' + this.identity + '-' + this._next;
    this._next += 1;
    if (!ID_PATTERN.test(id)) {
      throw new Error('this process has allocated too many ids');
    }
    return id;
  }
}

module.exports = {
  ID_PATTERN: ID_PATTERN,
  newIdentity: newIdentity,
  isValidId: isValidId,
  isValidRunTag: isValidRunTag,
  Allocator: Allocator
};
