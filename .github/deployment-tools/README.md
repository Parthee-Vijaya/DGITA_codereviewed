# Isoleret deploymentværktøj

Vercel CLI 62.2.0 holdes i et separat, låst dependencytræ. Appens dependencies ændres ikke. Brug Node 24 og `npm ci --prefix .github/deployment-tools --ignore-scripts`; brug altid `VERCEL_CLI_USE_NATIVE_BINARY=false`, så den testede Node-implementering og disse overrides faktisk benyttes på både macOS og Linux.

## Afgrænsede sikkerhedsrettelser

Den officielle rene installation gav 33 auditfund (8 moderate, 24 high, 1 critical). Følgende versioner er låst i manifestet og lockfilen:

| Afhængighed | Oprindelig | Fastlagt | Begrundelse |
| --- | --- | --- | --- |
| tar | 7.5.11 | 7.5.22 | Lukker bl.a. kritisk ubegrænset dekomprimering og parsefejl |
| ajv | 8.6.3 | 8.20.0 | Sikkerhedsrettet inden for samme major |
| js-yaml | 4.1.1 | 4.3.2 | Rettelser til merge/alias-kompleksitet |
| minimatch | 10.1.1 | 10.2.6 | Rettelser til glob-ReDoS |
| path-to-regexp | 6.1.0 / 8.3.0 | 6.3.0 / 8.4.2 | Bevarer majorversioner og retter regex-angreb |
| smol-toml | 1.5.2 | 1.9.0 | Retter parser-DoS inden for samme major |
| undici | 5.28.4 / 5.29.0 | 6.29.0 | v5 er udgået og har ingen opdateret sikker backport; v6 understøtter den valgte Node-runtime |

Undici er en bevidst majoropdatering, ikke blot en patch. Anvendte HTTP-grænseflader (`request`, `fetch`, `Headers`, `Agent`) afprøves mod en lokal server. CLI-version, `pull/build/deploy/promote --help`, arkivering og normale parser-/routemønstre verificeres. Det erstatter ikke en rigtig pilotrelease med Vercel-credentials. En livepilot skal verificeres før produktionsaccept.

Efter rettelserne er der **0 critical, 0 moderate og 21 high-pakkenoder**. Alle 21 er transitive påvirkninger af samme `braces@3.0.3` advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), som endnu ikke har en upstreampatch. `audit-policy.json` begrænser undtagelsen til hver navngiven dev-node/version/advisory og udløber 4. november 2026 kl. 00.00 UTC. Isolerede CI-runners bruger faste repo-/build-globmønstre og jobtimeouts. Der er ingen criticalundtagelse eller generel ignorering. Risikoejeren skal revurdere eller fjerne undtagelsen før udløb.

```sh
node scripts/ci-audit.mjs .github/deployment-tools .github/deployment-tools/audit-policy.json work/ci/deployment-tools
node --test scripts/ci-deployment-tools.test.mjs
```

Opdatér manifest, lockfil og eventuelt den præcise undtagelsesliste samlet efter review. Fjern hvert override, når upstream selv leverer en sikker kompatibel version. Dependabot opretter særskilte opdateringer til denne mappe. GitHub-actions for både CI og release bruger `npm ci` og skal bestå denne audit og kompatibilitetstests, før CLI'en får deploymentcredentials.

Primære kilder: [Undici supportmatrix](https://github.com/nodejs/undici), [Undici v6.0.0 ændringer](https://github.com/nodejs/undici/releases/tag/v6.0.0), [Vercel CLI](https://vercel.com/docs/cli), [kritisk tar advisory](https://github.com/advisories/GHSA-23hp-3jrh-7fpw).
