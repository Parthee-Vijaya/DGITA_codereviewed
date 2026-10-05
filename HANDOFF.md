# DGITA - fortsættelse efter produktionsklargøring

Fremtidigt arbejde pushes til `origin`: Parthee-Vijaya/DGITA_codereviewed. Det oprindelige DGITA-repo er bevaret som `upstream`; push ikke ændringer dertil. Grundklargøringen er flettet gennem PR #3/#16. K01–K12-kandidaten ligger i PR #17; kontrollér PR-status og eksakt SHA før videre arbejde. Se hovedbranchens historik og daterede rapporter for endelig SHA.

## Status og kildeorden

Læs README.md, docs/candidate-readiness.md, docs/governance/control-register.json, docs/municipal-acceptance.md, docs/production-operations.md og docs/ci-cd.md. Verificér altid aktuel Git-SHA, git status, seneste GitHub Quality gates og CodeQL-alerts. Rapporter fra 5. oktober 2026 er dateret evidens, ikke fremtidig driftsgaranti.

Testlogin bevares lokalt/pilot; produktion afviser testidentiteter og automatisk demo-seed. Produktion kræver eksplicit migration og korrekt checksum-ledger, Entra, separat DB/privat Blob, scanner og mailopsætning. Den eksisterende onlinepilot er ikke deployet eller ændret af klargøringen.

## Gentag verificering

Brug Node 24 og lockfiler. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build:next`, `npm run test:ci:next-e2e`, `npm run test:ci:production`, `npm run test:ci:e2e` og `npm run test:ci:a11y`. De isolerede tests kræver ingen cloudsecrets, men runtimeprøverne kræver et rent committet checkout. Byg Next fra samme SHA først. `node scripts/release-evidence.mjs` udtrækker målt, redigeret evidens; det accepterer ingen organisatoriske forhold. Deploymentværktøjer har egen lockfil, auditpolitik og kompatibilitetstest; se docs/ci-cd.md.

## Før kommunal drift

- Udpeg systemejer, drift og mindst én anden menneskelig kodereviewer/frigiver.
- Vælg og godkend platform, databehandling, aftaler og dataplacering. GitHub-release er forberedt til Vercel; Azure/Hetzner er ikke implementeret.
- Etablér særskilt pilot/produktion og verificér Entra/MFA, brugerafgang, private filer, malwaretjeneste og mail i det rigtige miljø.
- Gennemfør restore, rollback, belastning, hændelsesøvelse og overvågningsaccept.
- Afklar journalisering/bevaring, databeskyttelse og tilgængelighed inklusive PDF. Testidentiteter fra kilderepoet skal gennemgås før offentlig pilot.
- Følg de snævre development-advisories; undtagelser udløber 4. november 2026. Produktionsafhængigheder skal fortsat have nul auditfund.

GitHub-miljøerne er oprettet med deployment slået fra. Aktivér dem først efter konkret opsætning og accept. Sæt aldrig approvalflag for at omgå manglende evidens. Ingen credentials, persondataeksporter eller lokale miljøfiler i Git.

## Særlige fortsættelsespunkter

- Vercel har ved seneste metadatareview ingen særskilt previewkonfiguration. Det eksisterende releaseworkflow bruger production-target også ved valg af pilot. En ny preview skal have isolerede ressourcer og en eksplicit previewvej; den gamle pilot bevares.
- Restorekopier får obligatorisk karantæne, og normal appopstart afvises. Ingen automatisk genaktivering.
- Retention er en ren reviewberegning, ikke et slettejob. Backup-, servicemål- og kommunale acceptfelter forbliver ukendte indtil konkret evidens.
- HTML-kvittering er versionsbundet; tagged PDF er en prototype. Gemte PDF-bytes omskrives ikke.
- Workerudvikling har en snæver midlertidig konsolkompatibilitetsadapter; se docs/tooling-debt.md og fjern den ved en verificeret upstreamrettelse.
