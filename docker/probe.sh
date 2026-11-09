#!/bin/sh
# Makes one unauthenticated GET /api to the Fusion URL and prints one line of JSON:
#   {"ok":true,"version":"5.9.16","trustedHttpRealms":["name", ...]}
#   {"ok":false,"reason":"..."}
# Exit status 0 when Fusion answered, 1 when not. It reads the Fusion URL and the TLS
# settings from the file named by its first argument (no secret is in that file).
set -u
. "$1"
tmp_dir=$(dirname "$1")/tmp
body=$(mktemp "$tmp_dir/probe.XXXXXX") || exit 1
trap 'rm -f "$body" "$body.err"' EXIT

set -- -sS --max-time 10 --connect-timeout 5 -o "$body" -w '%{http_code}'
if [ "$FUSION_TLS_VERIFY" = off ]; then
  set -- "$@" -k
fi
if [ -n "$FUSION_CA_FILE" ]; then
  set -- "$@" --cacert "$FUSION_CA_FILE"
fi
code=$(curl "$@" "$FUSION_URL/api" 2>"$body.err")
rc=$?

fail() {
  jq -n -c --arg reason "$1" '{ok: false, reason: $reason}'
  exit 1
}

if [ "$rc" -ne 0 ]; then
  case $rc in
    6) fail "the host name of the Fusion URL does not resolve (DNS)" ;;
    7) fail "the connection to Fusion was refused or the network is unreachable" ;;
    28) fail "Fusion did not answer within 10 seconds" ;;
    35 | 51 | 58 | 59 | 60 | 77 | 83) fail "the TLS handshake with Fusion failed or its certificate is not trusted (TLS verification; set FUSION_CA_FILE for a private certificate authority)" ;;
    *) fail "the request to Fusion failed (curl exit status $rc)" ;;
  esac
fi
if [ "$code" != 200 ]; then
  fail "the Fusion URL answered HTTP $code to GET /api, so it does not look like a Fusion gateway"
fi
if ! jq -e '(.enabledRealms | type == "array") and (.version | type == "string")' "$body" >/dev/null 2>&1; then
  fail "GET /api answered something that is not a Fusion gateway response"
fi
jq -c '{ok: true, version: .version, trustedHttpRealms: [.enabledRealms[] | select(((.realmType // "") | ascii_downcase) == "trusted-http") | .name]}' "$body"
