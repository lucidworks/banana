#!/bin/sh
# Renders one config.js for Banana from the environment, on standard output.
#
#   render-config.sh root    the page at /: sets the login URL (FUSION_LOGIN_URL, default /auth/login)
#   render-config.sh mount   the page at /admin/banana/: login URL and session path stay at the defaults
#
# The preset (the Fusion values Banana 1.6.30 ships) and the list of settings that exist come from
# settings.json, which the image build writes from the application's own settings.js and config.js.
# BANANA_SETTING_<name> sets one setting. Only names that settings.js lists are accepted, values are
# typed (booleans, a list of panel names, paths, strings) and written as JSON, never pasted as text.
set -eu
LIB=${BANANA_LIB_DIR:-/usr/local/lib/banana}
variant=${1:-root}
case $variant in
  root | mount) ;;
  *) echo "usage: render-config.sh root|mount" >&2; exit 2 ;;
esac


json=$(jq -n --slurpfile S "$LIB/settings.json" --arg preset "${BANANA_PRESET:-fusion}" --arg variant "$variant" \
  --arg loginUrl "${FUSION_LOGIN_URL:-/auth/login}" -f "$LIB/render-config.jq" 2>&1) || {
  printf '%s\n' "$json" | sed 's/^jq: error (at [^)]*) *: *//; s/^jq: error: *//' >&2
  exit 1
}

# Nothing in the JSON can end the script: < > & and the two line separators are written as escapes.
ls_char=$(printf '\342\200\250')
ps_char=$(printf '\342\200\251')
printf '%s\n' "// Generated when the container started, from its environment. Do not edit; restart the container to change it."
printf '%s\n' 'define(["settings"],'
printf '%s\n' 'function (Settings) {'
printf '%s\n' '  "use strict";'
printf '%s' '  return new Settings('
printf '%s' "$json" | sed -e 's/</\\u003c/g' -e 's/>/\\u003e/g' -e 's/&/\\u0026/g' -e "s/$ls_char/\\\\u2028/g" -e "s/$ps_char/\\\\u2029/g"
printf '%s\n' ');'
printf '%s\n' '});'
