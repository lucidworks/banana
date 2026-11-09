# Shared helpers for the container start-up scripts (sourced, not run).

log() {
  printf '%s\n' "banana: $*" >&2
}

warn() {
  printf '%s\n' "banana: warning: $*" >&2
}

die() {
  printf '%s\n' "banana: error: $*" >&2
  exit 1
}

lower() {
  printf '%s' "$1" | tr 'A-Z' 'a-z'
}

# on_off NAME DEFAULT: the value of the variable NAME, which must be "on" or "off".
on_off() {
  _value=$(eval "printf '%s' \"\${$1:-$2}\"")
  _value=$(lower "$_value")
  case $_value in
    on | off) printf '%s' "$_value" ;;
    *) die "$1 must be on or off" ;;
  esac
}

# HMAC-SHA-256 (RFC 2104) of a message under a 32-byte key given as 64 hexadecimal
# characters, built from sha256sum and xxd, which the image has.
hmac_sha256() {
  _key_hex=$1
  _message=$2
  _padded="${_key_hex}$(printf '%064d' 0)"
  _padded=$(printf '%s' "$_padded" | cut -c1-128)
  _ipad=''
  _opad=''
  _i=0
  while [ "$_i" -lt 64 ]; do
    _byte=$(printf '%s' "$_padded" | cut -c$((_i * 2 + 1))-$((_i * 2 + 2)))
    _ipad="${_ipad}$(printf '%02x' $((0x$_byte ^ 0x36)))"
    _opad="${_opad}$(printf '%02x' $((0x$_byte ^ 0x5c)))"
    _i=$((_i + 1))
  done
  _inner=$({ printf '%s' "$_ipad" | xxd -r -p; printf '%s' "$_message"; } | sha256sum | cut -d' ' -f1)
  { printf '%s' "$_opad" | xxd -r -p; printf '%s' "$_inner" | xxd -r -p; } | sha256sum | cut -d' ' -f1
}
