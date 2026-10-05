# CI/CD og frigivelse

CI kontrollerer kode, test, afhængigheder og sikkerhed på GitHub. Et manuelt, beskyttet Vercel-releaseflow er implementeret med udgangspunkt i den eksisterende platform. Det er ikke kørt mod et rigtigt driftsmiljø; miljøer, credentials, migrationsstatus og kommunal accept skal være på plads, før det kan aktiveres. Et grønt build dokumenterer de kontroller, der er beskrevet her, og er ikke i sig selv en produktionsgodkendelse.

## Kvalitetskrav i GitHub Actions

Workflowet `Quality gates` kører for pull requests, pushes til `main`, merge queue, manuel start og hver mandag. Alle jobs har tidsgrænser og parallelle kørsler på samme ref afløser hinanden. Node 24 LTS og `npm ci` bruges med den committede lockfil. Handlinger er låst til fulde commit-SHA'er, kontrolleret mod udgivernes repositories den 5. oktober 2026.

| Kontrol | Hvad den dokumenterer | Begrænsning |
| --- | --- | --- |
| Lint, types and regression tests | ESLint, TypeScript, worker-build, unit- og databaseintegrationstests | En del eksisterende regressionstests undersøger kildekode frem for browseradfærd |
| Next production build and smoke | Produktionsbuild, lokal `next start`, login, liveness, sikkerhedsheaders, anonym adgangsafvisning og deaktiveret testlogin i produktion | Ingen rigtig produktionsdatabase, identitetsudbyder eller filstorage |
| Isolated application workflow | Testroller, sagsforløb, versioner, godkendelse, PDF-kvitteringer, intern/ekstern dialog, adgangskontrol, billeder og mailkø | API-forløb med lokal Cloudflare-emulator og syntetiske testdata; ingen browser-/WCAG- eller cloudintegrationstest |
| Dependency audit and SBOM | `npm audit` for både drift og build samt CycloneDX-inventar | Alle runtimefund stoppes. Kun to tidsbegrænsede, præcise dev-undtagelser accepteres; nye fund stoppes |
| Deployment toolchain audit and compatibility | Separat låst og patchet Vercel CLI, auditpolitik og HTTP/arkiv/CLI-adfærdstests | Én afgrænset braces-rest-risiko; rigtig pilotrelease er stadig nødvendig |
| Secret scan | Gitleaks på hele den tilgængelige git-historik og checkout | Mønsterbaseret kontrol kan ikke bevise fravær af alle hemmeligheder |
| Workflow validation | actionlint validerer workflow-syntaks, kontekster og shell | Erstatter ikke gennemgang af workflow-rettigheder |
| Dependency change review | Nye sårbare afhængigheder stoppes i pull requests fra high og op | Kræver dependency graph og GitHub-understøttelse |
| CodeQL (JavaScript/TypeScript og Actions) | Statisk sikkerhedsanalyse med `security-extended` | Gennemført analyse betyder ikke nul fund; review af alerts og merge protection er separate krav |
| Required quality gate | Alle relevante jobs er gennemført med succes; afbrudte eller fejlende jobs afvises | Skal aktiveres som obligatorisk statuscheck i en branch rule for at blokere merge |

Workflowet har som udgangspunkt kun `contents: read`. Kun CodeQL får `security-events: write` til analyseresultater. Checkout efterlader ikke GitHub-token i Git-konfigurationen. Ingen CI-job får produktionssecrets. `pull_request_target` anvendes ikke, og status fra jobs føres til slutkontrollen gennem miljøvariabler, ikke indsat i shellkode.

Tests kopierer projektet til en midlertidig mappe, udelader lokal `.env*`, `.dev.vars*` og eksisterende state og bruger et tilfældigt lokalt portnummer. E2E bruger et eksplicit pilotmiljø. Produktionstesten bruger `DGITA_ENVIRONMENT=production` og testlogin slået fra. Processer stoppes som en samlet procesgruppe ved afslutning, fejl eller afbrydelse. Readiness har tidsgrænse og kræver en fungerende login-side; `/api/healthz` kontrollerer kun liveness, ikke eksterne integrationers tilgængelighed.

Testlogs og resultat-JSON gemmes som artifacts i syv dage. Afhængighedsinventar og auditresultat gemmes i 14 dage. De indeholder kun data fra isolerede tests. Gitleaks-fund redigeres i loggen; der uploades ikke en rå secret-rapport.

## Lokal gentagelse

Brug Node 24 LTS. Kommandoerne ændrer kun lokale build-/testfiler og kræver ingen cloudsecrets:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build:next
npm run test:ci:production
npm run test:ci:e2e
node --test scripts/ci-audit.test.mjs scripts/ci-release.test.mjs
node scripts/ci-audit.mjs
npm ci --prefix .github/deployment-tools --ignore-scripts
node scripts/ci-audit.mjs .github/deployment-tools .github/deployment-tools/audit-policy.json work/ci/deployment-tools
node --test scripts/ci-deployment-tools.test.mjs
node scripts/ci-download-tool.mjs actionlint
work/ci-tools/actionlint
node scripts/ci-download-tool.mjs gitleaks
work/ci-tools/gitleaks git --redact --no-banner --log-opts="--all"
```

`npm test` bygger worker-bundlen først, fordi renderingstests bruger den. `npm run test:unit` kan kun køres separat, når worker-bundlen allerede er bygget. Produktionssmoke kræver tilsvarende et frisk `npm run build:next`.

Værktøjsdownload understøtter Linux x64 (GitHub runner) og macOS arm64. Gitleaks 8.30.1 og actionlint 1.7.12 downloades fra officielle GitHub Releases og kontrolleres mod fastlagte SHA-256-digests før udpakning. Opdatér version og digest samlet efter review. Dependabot vedligeholder npm-afhængigheder og GitHub Actions ugentligt; de to selvstændige værktøjsversioner skal gennemgås manuelt månedligt.

## GitHub-indstillinger før beskyttet levering

Følgende er konfigureret og læst tilbage via GitHub API den 5. oktober 2026. Dette er et dateret øjebliksbillede; gentag kontrollen før frigivelse.

| Indstilling | Verificeret status | Resterende handling |
| --- | --- | --- |
| Repository | Offentligt, `Parthee-Vijaya/DGITA_codereviewed` | Afklar kommunens vedligeholder-/ejermodel; ingen persondata eller driftssecrets i repo |
| `main` branch protection | Pull request, opdateret branch, løste samtaler og `Required quality gate` fra GitHub Actions app 15368; gælder også admins | Bevar; force push og sletning er slået fra, lineær historik kræves |
| Menneskeligt kodereview | CODEOWNERS peger på nuværende ejer; 0 obligatoriske approvals | Udpeg mindst én anden vedligeholder og aktivér uafhængigt review før kommunal drift |
| Actions standardtoken | Læseadgang, kan ikke godkende PR'er | Bevar mindst mulige rettigheder |
| Actions SHA-policy | Repositoryet kræver fulde commit-SHA'er; readback `sha_pinning_required=true` | Bevar ved opdatering af actions |
| Secret scanning / push protection | Begge aktiveret | Bevar og fastlæg triageansvar |
| Dependabot | Advisories og security updates aktiveret; ugentlige konfigurerede opdateringer | Følg nye PR'er og advisories; restundtagelser udløber 4. november |
| Private vulnerability reporting | Aktiveret | Fastlæg sikkerhedskontakt, responstider og beredskab |
| CodeQL | Advanced workflow for JS/TS og Actions; faktiske analyser er gennemført | Analysefund skal triageres særskilt; et grønt analysejob er ikke nul fund |
| Code scanning merge protection | CodeQL-jobs er del af den obligatoriske gate | Et selvstændigt ruleset med alarmtærskel skal kontrolleres separat |
| GitHub environments | `pilot` og `production`: kun beskyttede branches, Parthee som required reviewer, deployment slået fra | Særskilte cloudprojekter/credentials mangler. Selv-review er tilladt, indtil en anden ansvarlig er udpeget |

Begge miljøer har `DGITA_DEPLOYMENT_ENABLED=false`; produktion har også `DGITA_PRODUCTION_APPROVED=false`. Disse spærrer må først ændres efter konkret teknisk og organisatorisk accept. Ingen live-deployment er udført af denne klargøring. Den eksisterende onlinepilot og dens testkode er bevaret.

CI er hostinguafhængig. Det manuelle Vercel-flow er forberedt, men ekstern opsætning og en rigtig releasekørsel er stadig åbne driftsopgaver. Azure/Hetzner er mulige senere beslutninger og er ikke implementeret som deploymål.

## Afgrænsede undtagelser for udviklingsværktøjer

Den 5. oktober 2026 viste fuld `npm audit` **8 high og 4 moderate fund**, fordelt over 12 pakkenavne / 13 konkrete installnoder. `npm audit --omit=dev` viste **0 fund**. Fundene er ikke fjernet eller skjult:

| Advisory | Berørt direkte node | Risiko og afgrænsning | Næste handling |
| --- | --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces@3.0.3`, kun dev | Stack exhaustion ved dybt indlejrede globmønstre. Kendte build-/lintmønstre, isolerede runners og jobtimeouts begrænser eksponering. Officiel advisory angiver endnu ingen rettet version | Følg upstream og opdatér forældrepakker ved en understøttet rettelse |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `esbuild@0.18.20` under `@esbuild-kit/core-utils` i drizzle-kit, kun dev | Sårbar udviklingsserver. Denne server startes ikke af CI eller migrationskommandoen. Den almindelige Vite/esbuild-installation er en anden node | Opdatér/udskift Drizzle-værktøjskæden uden at nedgradere den aktive migrationsmodel; rettet esbuild findes fra 0.25.0 |

`.github/dependency-audit-policy.json` er den præcise undtagelsesliste. Den matcher advisory-ID, npm advisory-source, range, severity og **hver installsti og version**, også transitivt berørte forældrepakker. Alle noder skal være markeret `dev: true` i lockfilen. Alle production-fund, nye/ændrede advisories, pakkeversioner, paths, runtimeomklassificering og udløb stopper kontrollen. Auditnetværksfejl stopper også kontrollen.

Undtagelser udløber **4. november 2026 kl. 00.00 UTC**. De skal revurderes før den dato; udløbet forlænges ikke automatisk. Ejer er repositoryvedligeholderen, og kommunen skal udpege en teknisk risikoejer før produktion. De fem adfærdstests i `scripts/ci-audit.test.mjs` verificerer afvisningerne. Actions-artifacts bevarer rå auditdata uden secrets og en særskilt policyrapport, så de accepterede restfund kan efterprøves. Der er fortsat kendt toolingrisiko; CI-status må ikke gengives som "ingen sårbarheder i hele dependencytræet".

## Manuel Vercel-release

`Manual Vercel release` kræver en fuld 40-tegn commit-SHA, miljøet `pilot` eller `production` og et eksplicit valg om promotion (standard: fra). Workflowet skal startes fra `main`. Guard-scriptet kræver beskyttet `main`, at SHA findes på denne branch, og at seneste push-CI på netop denne SHA samt `Required quality gate` er gennemført med succes. Kilde og CI kontrolleres igen efter godkendelse før promotion.

`pilot` og `production` skal pege på **hver sit Vercel-projekt, database og private fillager**. Begge bygger mod eget projekts Vercel Production-konfiguration. `DGITA_ENVIRONMENT=pilot` beholder testlogin; produktionsprojektet skal have `DGITA_ENVIRONMENT=production` og `DGITA_ENABLE_DEV_LOGIN=false`. Den lokale production-preflight køres på de hentede miljøværdier. Secrets og `.vercel/output` uploades aldrig som Actions-artifacts; den hentede env-fil slettes efter jobbet.

Vercel CLI er fastlagt til **62.2.0**, verificeret i npm den 5. oktober 2026, i en separat lockfil under `.github/deployment-tools`. Den rene officielle installation havde **33 fund: 8 moderate, 24 high og 1 critical**. Afgrænsede overrides lukker alle øvrige advisories, inklusive kritisk `tar`, og efterlader **21 high-pakkenoder, alle fra samme braces-advisory uden upstreampatch**. Den særskilte tools-policy tillader kun de præcise dev-noder indtil 4. november; der er ingen criticalundtagelse. Undici5→6 er en bevidst majoropdatering, der testes med HTTP-grænseflader og CLI-kommandoer. Node-CLI bruges eksplicit, så en indbygget native binær ikke kan omgå de testede overrides. Se `.github/deployment-tools/README.md` for versioner, risici og reproduktion. Toolchain-audit og kompatibilitetstests er en del af både CI og release før CLI-adgang til token. Kun build-outputtet fra `vercel build --prod` deployes med `--prebuilt --prod --skip-domain`. SHA-256 af outputtet, Git-SHA, miljø og workflow-run-ID gemmes i deploymentmetadata. Guard validerer projekt, READY-status, target, SHA, hash og run før smoke og promotion.

Deploymentet oprettes uden at flytte de aktive domæner. Smoke kræver liveness, rigtig database-/schema-readiness, login-side og anonym adgangsafvisning. Pilotens testlogin afprøves med det beskyttede testkodeord; produktionskandidaten skal afvise testlogin. Der logges ingen kodeord, sessionsdata eller miljøværdier. `promote=true` frigiver først samme verificerede kandidat efter GitHub environment-godkendelse. Ved promotion af en **staged production** sker der ingen rebuild; promotion af en almindelig Preview kan genbygge og bruges derfor ikke her.

På hvert GitHub environment kræves:

- Variabler `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DGITA_DEPLOYMENT_ENABLED=true` (hold denne fra indtil opsætning er verificeret).
- Secret `VERCEL_TOKEN` med begrænset team-/projektadgang og rotationsansvar. Eventuelt `VERCEL_AUTOMATION_BYPASS_SECRET`, hvis Deployment Protection kræver det for smoke.
- På production yderligere `DGITA_PRODUCTION_APPROVED=true`, som først må sættes efter kommunens dokumenterede driftsaccept. Variablen er en bevidst frigivelsesspærre, ikke dokumentation for compliance.
- Navngivne required reviewers, selv-review slået fra hvor understøttet og deployment kun fra beskyttet `main`. Staging-jobbet og promotion-jobbet kan hver kræve godkendelse, da begge bruger miljøets credentials.

Før første produktionskandidat skal operatøren tage/verificere backup og køre de reviewede SQL-migreringer gennem `scripts/migrate.mjs`. Workflowet udfører ikke automatiske datamigreringer. Kandidatens readiness stopper ved manglende schema. Deaktivér Vercels automatiske Git-promotions og andre deploymentveje, der kan omgå GitHub-gaten. Rollback skal følge den godkendte driftsprocedure og en afprøvet databasekompatibilitetsplan.

Vercel-token, projekter, adskilte dataressourcer, miljøgodkendelser, migrationskørsel, cloudidentitet og en virkelig deployment/promotion er **ikke verificeret af en lokal workflowtest**. Hvis disse mangler, stopper flowet og den konkrete resterende opsætning skal fremgå af produktionsrapporten.

## Plan for produktionsaccept

1. Beslut Azure, Hetzner eller Vercel, region, leverandør-/databehandleraftale og ejerskab af database, filer, logs og identitet. Den eksisterende kode har Cloudflare- og Vercel-adaptere; Azure/Hetzner kræver konkret adapter-/driftsarbejde.
2. Opret adskilte pilot- og produktionsmiljøer. Pilot beholder kontrolleret testlogin med fiktive data; produktion skal bruge kommunens godkendte identitet og rolle-/kommunetilknytning.
3. Opret miljøbeskyttelse med manuel godkendelse før produktionsjob og branch-begrænsning til beskyttet `main`/godkendte tags. Brug OIDC og kortlivede credentials, hvor platformen understøtter det.
4. Byg én uforanderlig release efter alle kvalitetskrav. Gem commit-SHA, SBOM, dependency-audit og testresultater med release. Udgiv samme verificerede artifact til pilot og efter godkendelse til produktion.
5. Kør versionsstyrede, reviewede datamigreringer med backup og afprøvet gendannelse. Fastlæg håndtering af bagudkompatibilitet, databevaring og rollback før automatisk migration.
6. Verificér readiness mod rigtig database/filstorage og autentifikation, fuldt sagsforløb, adgangsafvisning på tværs af kommuner, logning uden følsomme data samt overvågning og alarmer. Afprøv gendannelse på en kopi.
7. Godkend driftsansvar, incidentproces, patchfrister og rollback. Dokumentér pilotaccept og ansvarlig beslutningstager før første produktionsrelease.

## Primære kilder

- [GitHub: sikker brug af Actions, rettigheder og SHA-pinning](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub: code scanning merge protection](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection)
- [GitHub: environments og deploymentbeskyttelse](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [CodeQL Actions og understøttede versioner](https://github.com/github/codeql-action)
- [Gitleaks release 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
- [actionlint release 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)

- [Vercel: deploy, prebuilt og skip-domain](https://vercel.com/docs/cli/deploy)
- [Vercel: staged production og promotion uden rebuild](https://vercel.com/docs/deployments/promoting-a-deployment)
