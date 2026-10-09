# DGITA - fortsættelse efter produktionsklargøring

Fremtidigt arbejde pushes til `origin`: Parthee-Vijaya/DGITA_codereviewed. Det oprindelige DGITA-repo er kun reference; push ikke ændringer dertil. Grundklargøringen er flettet gennem PR #3/#16/#17. Den verificerede hovedbranch ved start 9. oktober 2026 var `8930b3c745d42b0b950086ffaf0b60ed4659dab2`; kontrollér altid aktuel PR-status og SHA før videre arbejde.

## Gennemførelsesplan · første leverance

Følg [docs/implementation/README.md](docs/implementation/README.md) og den komplette [64-punktsplan](docs/implementation/plan.json). Første leverance omfatter korrekt afpublicering og indlæsning, intern infrastrukturbeskrivelse med vurderingshistorik, fælles felt-/uploadvalidering, fælles kontaktmail, to dependencyrettelser og en isoleret previewvej. Den eksisterende CSS, navigation og formularens ti trin er bevaret. Ingen onlinepilot eller eksterne miljøflag ændres af denne leverance.

Migration 0007 er additiv. Historikken begynder med nye gemninger; den rekonstruerer ikke tidligere værdier. Almindelig drift kan ikke ændre eller slette historikken. Afklar den godkendte bevarings-/sletteproces under R25–R32 inden kommunal drift.

Anden etape ligger på `feat/assignment-and-work-filters` oven på PR #18: stabile personvalg, katalogrelationer, arbejdsfiltre og en eksplicit vej til tilbagekaldelse af åbne lederanmodninger. Se docs/implementation/people-catalog-and-filters.md. F02/F03 har fortsat kilde-/procesaccept, og F23 afventer konkret rollevalg. Fortsæt med denne afklaring og derefter F11–F17. B01–B08 er stadig foreslåede kommunale beslutninger. De relevante produktionsregler kræver afklaring af identitet, egne sager, ledermandat, genindsendelse, krav, journal og bevaring. Lokal kodeverifikation lukker ikke disse acceptpunkter.

Tredje etape ligger på `feat/case-corrections-and-ai-screening` oven på `feat/assignment-and-work-filters` (PR #19). Den tilføjer eksplicit retur med offentlig begrundelse/frister, terminalt afslag, bindende ledergodkendelse af aktuel version og manuel AI-screening med filtre/CSV. Se docs/implementation/correction-workflow.md og ai-screening.md. Der er ingen ny migration eller ændring af roller. Fortsæt herefter med F13/F14 og F05-kravgrundlaget; F15 kræver dette grundlag. F23 kræver stadig konkret rollevalg. Etaperne er reviewleverancer og må ikke regnes som flettet, deployet eller kommunalt accepteret alene ud fra dette dokument.

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

- Vercel har ved seneste metadatareview ingen særskilt previewkonfiguration. Det eksisterende releaseworkflow bruger production-target også ved valg af pilot. Den nye `preview-vercel.yml` har egen previewvej og kræver et godkendt register over isolerede ressourcer. Cloudopsætning og miljøaccept er fortsat åbne; den gamle pilot bevares.
- Restorekopier får obligatorisk karantæne, og normal appopstart afvises. Ingen automatisk genaktivering.
- Retention er en ren reviewberegning, ikke et slettejob. Backup-, servicemål- og kommunale acceptfelter forbliver ukendte indtil konkret evidens.
- HTML-kvittering er versionsbundet; tagged PDF er en prototype. Gemte PDF-bytes omskrives ikke.
- Workerudvikling har en snæver midlertidig konsolkompatibilitetsadapter; se docs/tooling-debt.md og fjern den ved en verificeret upstreamrettelse.
