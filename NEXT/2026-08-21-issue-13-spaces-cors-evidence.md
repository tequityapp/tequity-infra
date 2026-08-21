---
date: 2026-08-21
issue: 13
impact: patch
title: Produce the credential-free half of the Spaces upload-CORS evidence, and a probe for the rest
---

tequity-infra#13's complaint is not that upload CORS is unconfigured — `src/storage.ts`
already imports the authoritative bucket and declares the exact allowlist — but that the
apply is **unevidenced**. This adds the evidence that can be produced without a
credential, and a probe that produces the rest in one operator session.

`test/storage-offline-preview.test.ts` asserts what a production preview would show:
both DigitalOcean resources register with the concrete id `nyc3,tequity`, which is an
import rather than a create, so the apply adopts the existing bucket instead of replacing
it; the bucket keeps `acl: private`, `forceDestroy: false`, and versioning; the component
is protected; the CORS rule is exactly `PUT` from exactly `https://tequity.app` with
exactly `Content-Type` and `If-None-Match`; and no third resource of any kind is
registered, so the plan cannot reach anything unrelated.

`scripts/spaces-cors-probe.sh` answers what an offline preview cannot. It checks the
approved origin's preflight in both directions, proves the first conditional PUT succeeds
and the second returns `412`, verifies through a **signed** read-back that the stored
bytes are unchanged, and deletes the object it created even on an early failure. It runs
in no workflow, because it writes to the production bucket.

That probe gets one attempt with a production credential, so its request signing is
pinned by golden vectors cross-checked against an independent SigV4 implementation. A
change to the canonical request now breaks a test instead of producing a misleading `403`
in the middle of the credentialed session.
