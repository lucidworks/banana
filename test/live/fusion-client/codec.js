'use strict';

// Decoding helpers shared by the rule table. Everything here is strict: input
// that does not decode returns null, and the callers abort on null.

const decoder = new TextDecoder('utf-8', { fatal: true });

// Percent-decode `s` once as UTF-8. With `plus`, a plus sign is a space (form
// values). A malformed escape, or bytes that are not UTF-8, return null.
function percentDecode(s, plus) {
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '%') {
      const hex = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      bytes.push(parseInt(hex, 16));
      i += 3;
    } else if (c === '+' && plus) {
      bytes.push(0x20);
      i += 1;
    } else {
      const cp = s.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      for (const b of Buffer.from(ch, 'utf8')) {
        bytes.push(b);
      }
      i += ch.length;
    }
  }
  try {
    return decoder.decode(Uint8Array.from(bytes));
  } catch (e) {
    return null;
  }
}

function formDecode(s) {
  return percentDecode(s, true);
}

// True when a decoded string still holds a percent sign followed by two
// hexadecimal digits, which means it was encoded twice.
function looksDoublyEncoded(s) {
  return /%[0-9a-fA-F]{2}/.test(s);
}

// Split a raw query string (without the question mark) into decoded pairs.
// Returns null when any part does not decode. An empty string has no pairs.
function parsePairs(raw) {
  if (raw === '') {
    return [];
  }
  const out = [];
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    const rawName = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    const name = formDecode(rawName);
    const value = formDecode(rawValue);
    if (name === null || value === null) {
      return null;
    }
    out.push({ rawName: rawName, rawValue: rawValue, name: name, value: value });
  }
  return out;
}

module.exports = {
  percentDecode: percentDecode,
  formDecode: formDecode,
  looksDoublyEncoded: looksDoublyEncoded,
  parsePairs: parsePairs
};
