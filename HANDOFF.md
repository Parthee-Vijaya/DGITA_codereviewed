# DGITA - fortsættelse efter produktionsklargøring

Fremtidigt arbejde pushes til `origin`: Parthee-Vijaya/DGITA_codereviewed. Det oprindelige DGITA-repo er bevaret som `upstream`; push ikke ændringer dertil. Klargøringen er flettet gennem PR #3 med efterfølgende rettelser fra den fulde CodeQL-baseline. Se hovedbranchens historik og daterede rapporter for endelig SHA.

## Status og kildeorden

Læs README.md, docs/production-operations.md og docs/ci-cd.md. Verificér altid aktuel Git-SHA, git status, seneste GitHub Quality gates og CodeQL-alerts. Rapporter fra 5. oktober 2026 er dateret evidens, ikke fremtidig driftsgaranti.

Testlogin bevares lokalt/pilot; produktion afviser testidentiteter og automatisk demo-seed. Produktion kræver eksplicit migration og korrekt checksum-ledger, Entra, separat DB/privat Blob, scanner og mailopsætning. Den eksisterende onlinepilot er ikke deployet eller ændret af klargøringen.

## Gentag verificering

Brug Node 24 og lockfiler. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build:next`, `npm run test:ci:production` og `npm run test:ci:e2e`. De isolerede tests kræver ingen cloudsecrets. Deploymentværktøjer har egen lockfil, auditpolitik og kompatibilitetstest; se docs/ci-cd.md.

## Før kommunal drift

- Udpeg systemejer, drift og mindst én anden menneskelig kodereviewer/frigiver.
- Vælg og godkend platform, databehandling, aftaler og dataplacering. GitHub-release er forberedt til Vercel; Azure/Hetzner er ikke implementeret.
- Etablér særskilt pilot/produktion og verificér Entra/MFA, brugerafgang, private filer, malwaretjeneste og mail i det rigtige miljø.
- Gennemfør restore, rollback, belastning, hændelsesøvelse og overvågningsaccept.
- Afklar journalisering/bevaring, databeskyttelse og tilgængelighed inklusive PDF. Testidentiteter fra kilderepoet skal gennemgås før offentlig pilot.
- Følg de snævre development-advisories; undtagelser udløber 4. november 2026. Produktionsafhængigheder skal fortsat have nul auditfund.

GitHub-miljøerne er oprettet med deployment slået fra. Aktivér dem først efter konkret opsætning og accept. Sæt aldrig approvalflag for at omgå manglende evidens. Ingen credentials, persondataeksporter eller lokale miljøfiler i Git.
