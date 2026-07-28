#!/usr/bin/env bash
set -euo pipefail

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required for the Vault TLS render test" >&2
  exit 1
fi

render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
chart="$render_dir/vault-0.28.1.tgz"
rendered="$render_dir/rendered.yaml"

curl --fail --silent --show-error --location \
  https://helm.releases.hashicorp.com/vault-0.28.1.tgz \
  --output "$chart"
echo '99efe00f5527182e76d6e7a0ccf9d4797badd248cb8fe070fbe117e0b6cb58d7  '"$chart" \
  | sha256sum --check --status

helm template tequity-vault "$chart" \
  --namespace tequity \
  --values test/fixtures/vault-tls-values.json >"$rendered"

grep -q 'value: https://vault.tequity:8200' "$rendered"
grep -q 'value: /vault/tls/ca/ca.crt' "$rendered"
grep -q 'name: vault-tls-readiness' "$rendered"
grep -q 'vault status' "$rendered"
grep -q 'name: https' "$rendered"

if grep -Eq 'tls-skip-verify|VAULT_SKIP_VERIFY|http://vault|name: http$' "$rendered"; then
  echo "rendered Vault manifests contain plaintext or a TLS verification bypass" >&2
  exit 1
fi

echo "Vault chart render enforces HTTPS and trusted-CA probes."
