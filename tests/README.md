# Test Strategy (Unit + Integration + Behavioral)

This test suite is split into three layers:

- `tests/unit`
: formula-level and parser-level checks (`metricsCore`, `metricsExport`, save-request sanitization)
- `tests/integration`
: end-to-end pipeline checks across internal modules (synthetic metrics -> export model -> CSV)
- `tests/behavioral`
: synthetic audio examples with known theoretical properties:
  - silence (zero energy)
  - sine wave (RMS = A/sqrt(2), crest = sqrt(2))
  - square wave (RMS = peak amplitude, crest = 1)
  - impulse (very high crest factor)
  - clipped sine (higher clipping rate)

Run:

```bash
npm run test
```
