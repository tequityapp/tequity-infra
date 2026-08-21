#!/usr/bin/env bash

# tequity-infra#13 -- produce the LIVE half of the upload-CORS evidence against the
# authoritative DigitalOcean Spaces bucket. The offline half (that a production apply
# ADOPTS the bucket rather than replacing it, and configures exactly the approved
# origin, method, and headers) is `npm run preview:offline`, which needs no credential.
#
# This half needs one, so it is an operator action taken once with the transcript
# attached to the issue. It is deliberately not run by CI and by no workflow: it
# writes to the production bucket.
#
#   SPACES_KEY=... SPACES_SECRET=... bash scripts/spaces-cors-probe.sh
#
# It proves four things and then deletes what it created:
#   1. A browser preflight from the approved origin is answered for PUT with
#      Content-Type and If-None-Match, echoing that exact origin and not a wildcard.
#   2. A preflight from an unapproved origin is not answered.
#   3. A create-only conditional PUT (If-None-Match: *) succeeds on a fresh key.
#   4. The same conditional PUT returns 412 and the stored bytes are UNCHANGED --
#      create-only means the first writer wins.
#
# Credentials are read from the environment and never echoed: every signing value
# stays in a variable, and the transcript carries request/response metadata only.

set -euo pipefail

# Deterministic mode, used by test/spaces-cors-probe.test.ts to cross-check this
# signer against an independent SigV4 implementation. It prints one Authorization
# header and exits without contacting anything.
if [ -n "${SPACES_PROBE_SIGN_ONLY:-}" ]; then
  : "${SPACES_PROBE_FIXED_DATE:?deterministic mode requires SPACES_PROBE_FIXED_DATE}"
fi

: "${SPACES_KEY:?set SPACES_KEY to the probe access key (never commit it)}"
: "${SPACES_SECRET:?set SPACES_SECRET to the probe secret key (never commit it)}"

region="${SPACES_REGION:-nyc3}"
bucket="${SPACES_BUCKET:-tequity}"
approved_origin="${SPACES_APPROVED_ORIGIN:-https://tequity.app}"
unapproved_origin="${SPACES_UNAPPROVED_ORIGIN:-https://attacker.example}"
host="${bucket}.${region}.digitaloceanspaces.com"
key="${SPACES_PROBE_KEY:-tequity-cors-probe/$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM.txt}"
first_body='first-writer-wins'
second_body='second-writer-must-not-land'

workdir="$(mktemp -d)"
created=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

# The probe must not leave an object in the production bucket even if it aborts.
finish() {
  local status=$?
  if [ "$created" = '1' ]; then
    if [ "$(signed_request DELETE "$key" '' no "$workdir/delete.body")" = '204' ]; then
      printf 'PASS: the probe object was deleted\n'
    else
      printf 'FAIL: could not delete the probe object %s -- remove it by hand\n' "$key" >&2
      status=1
    fi
  fi
  rm -rf "$workdir"
  exit "$status"
}

hmac_hex() { printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" -hex | sed 's/^.*= //'; }
hmac_key_hex() { printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "key:$1" -hex | sed 's/^.*= //'; }
sha256_hex() { printf '%s' "$1" | openssl dgst -sha256 -hex | sed 's/^.*= //'; }

# signed_request METHOD KEY BODY CONDITIONAL(yes|no) OUTFILE -> prints the status code
signed_request() {
  local method="$1" object_key="$2" body="$3" conditional="$4" out="$5"
  local amzdate datestamp payload_hash credential_scope
  local canonical_headers signed_headers canonical_request string_to_sign
  local k_date k_region k_service k_signing signature authorization

  amzdate="${SPACES_PROBE_FIXED_DATE:-$(date -u +%Y%m%dT%H%M%SZ)}"
  datestamp="${amzdate%%T*}"
  payload_hash="$(sha256_hex "$body")"
  credential_scope="${datestamp}/${region}/s3/aws4_request"

  if [ "$conditional" = 'yes' ]; then
    canonical_headers="host:${host}
if-none-match:*
x-amz-content-sha256:${payload_hash}
x-amz-date:${amzdate}
"
    signed_headers='host;if-none-match;x-amz-content-sha256;x-amz-date'
  else
    canonical_headers="host:${host}
x-amz-content-sha256:${payload_hash}
x-amz-date:${amzdate}
"
    signed_headers='host;x-amz-content-sha256;x-amz-date'
  fi

  canonical_request="${method}
/${object_key}

${canonical_headers}
${signed_headers}
${payload_hash}"

  string_to_sign="AWS4-HMAC-SHA256
${amzdate}
${credential_scope}
$(sha256_hex "$canonical_request")"

  k_date="$(hmac_key_hex "AWS4${SPACES_SECRET}" "$datestamp")"
  k_region="$(hmac_hex "$k_date" "$region")"
  k_service="$(hmac_hex "$k_region" 's3')"
  k_signing="$(hmac_hex "$k_service" 'aws4_request')"
  signature="$(hmac_hex "$k_signing" "$string_to_sign")"
  authorization="AWS4-HMAC-SHA256 Credential=${SPACES_KEY}/${credential_scope}, SignedHeaders=${signed_headers}, Signature=${signature}"

  if [ -n "${SPACES_PROBE_SIGN_ONLY:-}" ]; then
    printf '%s\n' "$authorization"
    return 0
  fi

  local -a request=(
    curl -sS -o "$out" -w '%{http_code}' -X "$method"
    "https://${host}/${object_key}"
    -H "Host: ${host}"
    -H "x-amz-content-sha256: ${payload_hash}"
    -H "x-amz-date: ${amzdate}"
    -H "Authorization: ${authorization}"
  )
  [ "$conditional" = 'yes' ] && request+=(-H 'If-None-Match: *')
  [ -n "$body" ] && request+=(--data-binary "$body")
  "${request[@]}"
}

if [ -n "${SPACES_PROBE_SIGN_ONLY:-}" ]; then
  signed_request "${SPACES_PROBE_METHOD:-PUT}" "$key" \
    "${SPACES_PROBE_BODY-$first_body}" "${SPACES_PROBE_CONDITIONAL:-yes}" /dev/null
  rm -rf "$workdir"
  exit 0
fi

trap finish EXIT

# --- 1 and 2: the CORS configuration itself ------------------------------------
preflight() {
  curl -sS -o /dev/null -D "$2" -X OPTIONS "https://${host}/${key}" \
    -H "Origin: $1" \
    -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: content-type,if-none-match' || true
}

preflight "$approved_origin" "$workdir/approved.headers"
grep -qi "^access-control-allow-origin: ${approved_origin}" "$workdir/approved.headers" \
  || fail "the approved origin was not echoed by the preflight"
grep -qi '^access-control-allow-methods:.*PUT' "$workdir/approved.headers" \
  || fail 'PUT was not allowed by the preflight'
grep -qi '^access-control-allow-headers:.*if-none-match' "$workdir/approved.headers" \
  || fail 'If-None-Match was not allowed by the preflight'
if grep -qi '^access-control-allow-origin: \*' "$workdir/approved.headers"; then
  fail 'the bucket answered with a wildcard origin'
fi
pass "preflight from ${approved_origin} allows PUT with Content-Type and If-None-Match"

preflight "$unapproved_origin" "$workdir/unapproved.headers"
if grep -qi '^access-control-allow-origin:' "$workdir/unapproved.headers"; then
  fail "an unapproved origin (${unapproved_origin}) was answered"
fi
pass "preflight from ${unapproved_origin} is refused"

# --- 3 and 4: create-only conditional PUT --------------------------------------
status="$(signed_request PUT "$key" "$first_body" yes "$workdir/put1.body")"
[ "$status" = '200' ] || fail "first conditional PUT returned ${status}, expected 200"
created=1
pass 'first conditional PUT on a fresh key succeeds'

status="$(signed_request PUT "$key" "$second_body" yes "$workdir/put2.body")"
[ "$status" = '412' ] || fail "second conditional PUT returned ${status}, expected 412"
pass 'second conditional PUT on the same key returns 412'

# The bucket is private, so the read-back must be signed too. An unsigned GET would
# return a 403 body and comparing THAT to the payload would report a false change.
status="$(signed_request GET "$key" '' no "$workdir/stored")"
[ "$status" = '200' ] || fail "signed read-back returned ${status}, expected 200"
diff -q <(printf '%s' "$first_body") "$workdir/stored" >/dev/null \
  || fail 'the stored bytes changed after the rejected PUT'
pass 'the stored bytes are unchanged after the rejected PUT'

printf '\nProbe key: %s\n' "$key"
printf 'Attach this transcript to tequityapp/tequity-infra#13.\n'
