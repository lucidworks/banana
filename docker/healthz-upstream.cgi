#!/bin/sh
# FastCGI target of /healthz/upstream (only started when BANANA_HEALTH_UPSTREAM=on). nginx caches
# its answer for 10 seconds, so a flood of requests makes at most one call to Fusion per interval.
result=$(/usr/local/lib/banana/probe.sh /run/banana/probe.env)
status=$?
if [ "$status" -eq 0 ]; then
  http_status=200
else
  http_status=503
fi
printf '%s\n' "banana: /healthz/upstream: $result" >&2
printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n%s\n' "$http_status" "$result"
