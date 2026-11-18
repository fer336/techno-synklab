# Deviations (INF-900)

Proposals written by an agent. Under INF-901 an agent proposes; **only the owner approves**. Nothing here is accepted yet.

## INF-822 — `Co-authored-by` trailers for agent contributions

**Estado:** propuesta (pendiente de aprobación)
**Fecha:** 2026-11-17
**Aprobado por:** pendiente

**Motivo**
INF-822 requires a `Co-authored-by` trailer when an agent takes part in a change. The owner's standing instruction for agents in
this repository is the opposite: no `Co-authored-by` and no AI attribution in commits.

**Mitigación**
Agents follow the owner's instruction. Authorship stays with the owner; pipeline commits remain attributed to `github-actions[bot]`.

**Revisión**
2027-11-17

## INF-606 — Image vulnerability scan

**Estado:** propuesta (pendiente de aprobación)
**Fecha:** 2026-11-17
**Aprobado por:** pendiente

**Motivo**
The release workflow does not scan the image yet. It is a SHOULD; the single-service image is small and rebuilt on every release.

**Mitigación**
Base image `python:3.12-slim`, non-root user, no published ports other than through the proxy. Add a scanner step when there is capacity.

**Revisión**
2027-02-17

## INF-113 — Tag immutability at the registry level

**Estado:** propuesta (pendiente de aprobación)
**Fecha:** 2026-11-17
**Aprobado por:** pendiente

**Motivo**
GitHub Container Registry does not offer tag immutability. It is a SHOULD.

**Mitigación**
The release workflow refuses to overwrite a published tag (INF-112) by reusing the existing image when the tag already exists.

**Revisión**
2027-11-17

## INF-232 — CI check that `.env.example` covers the required variables

**Estado:** propuesta (pendiente de aprobación)
**Fecha:** 2026-11-17
**Aprobado por:** pendiente

**Motivo**
There is a single required variable (`MUSICBRAINZ_USER_AGENT`), validated at startup in production (`config.validate`) and covered by tests.

**Mitigación**
Fail-fast validation at boot plus unit tests for it.

**Revisión**
2027-05-17
