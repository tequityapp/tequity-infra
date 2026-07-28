# Remediate brace-expansion dependency chains

- Pin all transitive `brace-expansion` instances to 5.0.8, the first release
  outside GHSA-mh99-v99m-4gvg's affected range.
- Keep the override until Jest and Pulumi dependency trees natively resolve a
  patched release.
- Require the full dependency audit, build, tests, and offline Pulumi mock
  preview to pass.
