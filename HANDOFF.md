# DGITA — handoff pr. 14. oktober 2026

Dette dokument beskriver, hvad der er ændret, hvorfor, hvor arbejdet findes, hvad der er verificeret, og hvad næste person skal gøre. Status er et dateret øjebliksbillede, ikke en frigivelsesgodkendelse. Kontrollér aktuelle PR-heads, baser og checks før fortsættelse.

## 1. Aktuel tilstand og aftalt ramme

- **Repository:** [Parthee-Vijaya/DGITA_codereviewed](https://github.com/Parthee-Vijaya/DGITA_codereviewed). Fremtidige pushes går hertil. Det oprindelige `Parthee-Vijaya/DGITA` er kun reference.
- **Main:** `3c41099c613f4bcc08d0cbe6b22b30d7c39f7f39`, live-verificeret 14. oktober. KLE-arbejdet, vedligeholdelsesrunden og denne dokumentationsleverance har ikke ændret main eller deployet noget. Tidligere leverancers eventuelle deployments er ikke genverificeret her.
- **Arbejdsform:** En særskilt branch og PR pr. funktion/vedligeholdelsespakke. Ingen merge til main eller aktivering af et miljø som del af denne handoff.
- **UX/UI:** Bevar eksisterende visuelle stil, navigation og ansøgningens ti trin. Udbyg de relevante felter og hjælpetekster; indfør ikke et nyt hovedflow.
- **KLE:** Brugeren udfylder det, vedkommende kan, og kan få hjælp til resten på mødet med D-GITA-konsulenten. KLE er valgfrit. Der er ingen særskilt deling, mødebestilling eller konsulentanmodning i denne levering.
- **Datagrænse:** KLE er stadig lokal afprøvning med syntetiske data. Officielle KL-data, kommunal ejerfuldmagt, automatisk KITOS-skrivning og AI-analyse er ikke aktiveret.
- **Denne dokumentationsbranch:** `docs/project-handoff-2026-10-14`, oprettet fra PR #34 på `8fec75347a9875f8d90d0a65d7306eee0222783e`. Den tilsvarende PR har `chore/preview-setup-node-7` som base og ændrer kun `HANDOFF.md`. Øvrige vedligeholdelses-PR'er er beskrevet her, men er ikke flettet ind i denne branch.

Den særlige projekt-memory `vidensbase/projekter/dgita.md` findes ikke i den kanoniske oversigt på denne maskine. Brug denne handoff, planerne og live Git-status som fortsættelsesgrundlag; der er ikke oprettet en ny memory-fil.

## 2. Funktionelle ændringer og begrundelser

### Allerede flettet i main

PR #3, #16 og #17 leverede det tekniske grundlag: releasekontroller, rettelser af arvede CodeQL-fund, adgangs- og versionsgrænser, tilgængelige sagsforløb, kontrolregister, gendannelse og driftsmålinger. PR #15 opdaterede Vite til 8.3.1. PR #28 rettede vedvarende oprydning af bilag og andre kodegennemgangsfund. Disse leverancer er i main; den kommunale miljøaccept er fortsat en særskilt opgave.

### Implementeret på funktionsbranches, endnu ikke i main

| Leverance | Hvad er ændret | Hvorfor og afgrænsning | Detaljer |
| --- | --- | --- | --- |
| Første etape, PR #18 | CMS-afpublicering skjuler indhold korrekt; indhold indlæses for aktuel rolle/kommune; intern infrastrukturbeskrivelse med historik; fælles input-/uploadvalidering og kontaktmail; præcise sikkerhedspatches; isoleret preview-workflow. | Fjerne genopstået/fejlindlæst indhold, uens validering og manglende sporbarhed uden ændret hovedlayout. Infrastrukturhistorik er intern. | [Leverancebeskrivelse](docs/implementation/README.md), [historik](docs/privacy/review-history.md), [preview](docs/ci-cd.md). |
| Anden etape, PR #19, indarbejdet i #18 | Stabile personidentiteter og ekstra ansvarlige; katalogrelationer ved erstatning/tilkøb; kombinerbare arbejdsfiltre med matchende CSV; eksplicit tilbagekaldelse af åbne lederanmodninger. | Undgå navneforveksling og løse katalogreferencer, og gøre arbejdslisten brugbar. Autoritativ person-/organisationskilde og katalogets aktualitet afventer accept. | [Personvalg, katalog og filtre](docs/implementation/people-catalog-and-filters.md). |
| Tredje etape, PR #20, indarbejdet via #19 i #18 | Retur med offentlig begrundelse/frister, ny version ved genindsendelse, særskilt endeligt afslag og krav om ledergodkendelse af aktuel version; manuel AI-screening med filtre/CSV. | Skelne mellem rettelser og endeligt afslag samt undgå godkendelse på et forældet grundlag. AI-markering er manuel screening; der udføres ingen ekstern AI-analyse. | [Rettelsesflow](docs/implementation/correction-workflow.md), [AI-screening](docs/implementation/ai-screening.md). |
| Fjerde etape, PR #22/#23, samme head | Flere persondatakategorier samtidigt, særskilt kontraktværdi/aftaleform og interne databeskyttelses-/indkøbsvurderinger med begrundelse, referencer og versionshistorik. | Bevare førsteårsbudget og dataklassifikation, men give et mere præcist vurderingsgrundlag. Status “Dokumenteret” er ikke juridisk godkendelse. Ingen automatisk afgørelse efter beløbsgrænse. | [Vurderingsmodel](docs/implementation/case-assessments.md), [indkøbsoplysninger](docs/implementation/procurement-information.md), [kilder](docs/implementation/assessment-sources.md). |
| KLE/systemanvendelse, PR #29 | Samler etape 1–4 og aktuel main. Tilføjer selvstændigt register for systemanvendelser, manuel KLE-vurdering, syntetisk opgavematch, serverbundet registrantbekræftelse, samtidighedskontrol, gentagelsessikker oprettelse og uforanderlig historik. | En systemanvendelse skal kunne leve længere end én anskaffelsessag. Registrantbekræftelse giver ikke ejerfuldmagt eller NIS2-godkendelse. | [Systemanvendelser](docs/implementation/kle-system-lifecycle.md), [KLE-plan](docs/implementation/kle-system-lifecycle-plan.json). |
| Integreret KLE-søgning, også PR #29 | Serversøgning på kode, titel, stikord og beskrivelse; rangering og sider; bevarede valg; fejl/genforsøg; kilde-/versionskontrol. Offline XML-klargøring validerer struktur/identitet og registrerer SHA-256. | Undgå at brugeren skal forlade DGITA, og forberede en kontrolleret kildeudskiftning efter KL-aftale. Ingen scraping, officielle records eller automatisk synkronisering er aktiveret. | [Søge-/importkontrakt](docs/implementation/kle-search.md), `features/kle/`, `scripts/kle-prepare.mts`. |
| Mødevejledning, PR #30 | Hjælpetekst præciserer, at brugeren kan udfylde det kendte og få hjælp til resten på mødet. | Forhindre, at KLE opleves som en blokering eller et krav om fælles udfyldelse. Ingen nye roller eller delingsfunktion. | [PR #30](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/30). |
| KLE i ansøgningen, PR #31 | Valgfri søgning/multivalg ved spørgsmål 30 i lokal afprøvning; `kleSelection` med emner og kildeversion følger kladde, indsendelse, rettelser, sagsvisning og kvittering. `kleTopics`-fritekst og gamle kladder bevares. | Integrere KLE i den eksisterende ansøgning. Manglende valg eller søgefejl må ikke blokere en ellers gyldig ansøgning. Ingen automatisk oprettelse af en systemanvendelse. | [KLE i ansøgningen](docs/implementation/kle-application.md), `features/application/kle-selection.ts`, `features/kle/KleApplicationField.tsx`. |

**Dokumentationsrækkefølge:** Enkelte afsnit i `kle-search.md` beskriver tiden før PR #31 og siger stadig, at spørgsmål 30 kun er fritekst. Den aktuelle adfærd fremgår af `kle-application.md` og koden: integreret søgning ved spørgsmål 30 findes lokalt; pilot/produktion bruger fortsat fritekst. Harmonisering af de ældre afsnit er en konkret dokumentationsrestopgave.

## 3. Vedligeholdelsesrunde 14. oktober

### Opdateringer, som ligger klar hver for sig

Alle nedenstående 11 PR'er var åbne, umerged og havde **13/13 succesfulde GitHub-checks** på de angivne heads ved denne handoff. Grønne checks på forskellige heads er ikke i sig selv bevis for deres samlede integration; den fælles lokale prøve er beskrevet i afsnit 6.

| PR | Præcis ændring | Hvorfor / udført håndtering |
| --- | --- | --- |
| #32 | CodeQL init **og** analyze 4.38.2 → 4.38.3; fælles Dependabot-gruppe. | Begge dele skal bruge samme udgave. Ny samlet PR erstatter #25/#26. |
| #4 | dependency-review-action 4.9.0 → 5.0.0. | Opdateret med aktuel main og rettet den misvisende versionskommentar; frisk CI. |
| #24 | setup-node 6.5.0 → 7.1.0 i almindelig CI og release-workflow. | Opdateret med aktuel main; kontrolleret releaseværn. Ingen release udført. |
| #27 | upload-artifact 7.0.1 → 7.0.2. | Opdateret med aktuel main og præcise versionskommentarer; de fem forventede CI-artefaktarkiver kontrolleret som tilgængelige med indhold. |
| #14 | tsx 4.23.12 → 4.23.15. | Eksisterende dependency-diff bevaret og frisk CI kørt. |
| #13 | drizzle-orm 0.45.2 → 0.45.3. | Eksisterende dependency-diff bevaret; databaser/migrationer og begge runtimes indgår i prøverne. |
| #7 | @vitejs/plugin-react 6.0.2 → 6.1.2. | Kontrolleret mod begge builds og ny funktionskode. Branchens gamle navn ender stadig på 6.1.1; manifest/lockfil indeholder 6.1.2. |
| #9 | @libsql/client og @libsql/core 0.17.4 → 0.18.0; native `libsql` forbliver 0.5.29. Tre nye tests i `tests/libsql-lifecycle.test.mjs`. | Afprøver samtidig adgang under transaktion, commit/rollback, genbrug efter transaktionslukning og aktive/ventende kald ved klientlukning. Tests beskytter mod konkrete lifecycle-regressioner. |
| #6 | React, React DOM og RSC 19.2.8 → 19.3.0; React-types 19.2.14 → 19.3.0, DOM-types 19.2.3 → 19.3.0 og scheduler 0.27.0 → 0.28.0. | Bevarer versionssammenhængen og er prøvet med KLE og begge builds. Ingen UI-omlægning. |
| #33 | Tailwind, @tailwindcss/postcss, node og oxide 4.2.1 → 4.3.3; lightningcss 1.31.1 → 1.32.0; fælles Dependabot-gruppe. | Erstatter #10/#11. Lockfilen opdaterer 34 nødvendige pakkenoder og indeholder én Tailwind-version; ingen uvedkommende opgraderinger. |
| #34 | De to setup-node-kald i `preview-vercel.yml` til 7.1.0. | Workflowet findes kun på funktionsbranchen og dækkes derfor ikke af #24 mod main. Separat PR med præcis 2 tilføjede/2 fjernede linjer mod #31. |

Actions er fortsat låst til fulde commit-identiteter:

| Action | Verificeret pin |
| --- | --- |
| CodeQL init/analyze 4.38.3 | `24c54180a607b1449ed407dd24f251e4e9147c8d` |
| dependency-review 5.0.0 | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` |
| setup-node 7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| upload-artifact 7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

### Lukkede PR'er

| PR | Udført handling og begrundelse |
| --- | --- |
| #1 | Lukket uden merge: main indeholder allerede de relevante brace-expansion-versioner 1.1.21 og 5.0.12. |
| #2 | Lukket uden merge: main indeholder allerede Next/env/SWC 16.3.8 og matchende lintkonfiguration. |
| #25 og #26 | Lukket uden merge: erstattet af den samlede CodeQL-PR #32. |
| #10 og #11 | Lukket uden merge: erstattet af den samlede Tailwind/PostCSS-PR #33. |

Det er de seks PR'er lukket i denne runde. Tidligere lukkede PR'er #5/#21 er ikke nye handlinger her.

### To PR'er afventer en særskilt migration

- **#8, ESLint 10.12.0:** `react/display-name` fejler med `contextOrFilename.getFilename is not a function`. De nuværende `eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2` og `eslint-plugin-react@7.37.5` erklærer ikke kompatibilitet med ESLint 10; SBOM-kontrollen fejler også. Bevar ESLint **9.39.4**, indtil plugin-/Next-lintkombinationen er understøttet og lint/SBOM samt regressionstest består.
- **#12, TypeScript 7.0.2:** Den installerede typescript-eslint 8.71.1-familie kræver TypeScript `>=4.8.4 <6.1.0`. Lint rapporterer manglende understøttelse, og SBOM registrerer den ugyldige dependency-kombination. Bevar TypeScript **5.9.3**, indtil hele værktøjskæden er kompatibel.

Begge PR'er er fortsat åbne og uændrede med 10/13 succesfulde checks. De indgår ikke i den testede integrationskandidat. Svækkelse af peer-kontroller eller auditpolitik er ikke den planlagte løsning.

## 4. Eksakte PR-heads og baser

### Funktioner og preview

| PR | Status | Base | Head-branch | Head SHA |
| --- | --- | --- | --- | --- |
| [#18](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/18) | Åben | `main` | `feat/plan-first-improvements` | `edba65fa3433637246766242a75addbc3084c37c` |
| [#19](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/19) | Flettet i feature-base | `feat/plan-first-improvements` | `feat/assignment-and-work-filters` | `946cfb061871cf3c2a67c4e7578971a30a4e8113` |
| [#20](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/20) | Flettet i feature-base | `feat/assignment-and-work-filters` | `feat/case-corrections-and-ai-screening` | `6c13814f3612e4f7890387669a0cf04db2cb701e` |
| [#22](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/22) | Åben kladde | `feat/plan-first-improvements` | `feat/privacy-and-procurement-assessments` | `693a3625321de31a19f7ba07192be07f5d9df8c8` |
| [#23](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/23) | Åben | `main` | `feat/privacy-and-procurement-assessments` | `693a3625321de31a19f7ba07192be07f5d9df8c8` |
| [#29](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/29) | Åben kladde | `main` | `feat/kle-system-lifecycle` | `e8e90f12d9c8d661edacb73153baebdd81c69a12` |
| [#30](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/30) | Åben kladde | `feat/kle-system-lifecycle` | `fix/kle-meeting-guidance` | `4b600c2f43b61e2e1812ee217eedc5e3416ae708` |
| [#31](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/31) | Åben kladde | `fix/kle-meeting-guidance` | `feat/kle-in-application` | `a9edc1d5c904feb215ff6657eb1d081e7987bb1e` |
| [#34](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/34) | Åben kladde | `feat/kle-in-application` | `chore/preview-setup-node-7` | `8fec75347a9875f8d90d0a65d7306eee0222783e` |

PR #19 og #20 er flettet i andre featurebranches, **ikke i main**. PR #22 og #23 peger på samme head og repræsenterer samme kode med forskellig base. PR #29 indeholder PR #18, #22/#23 og aktuel main som faktiske forfædre; PR #19's sluttræ er identisk med PR #20's og PR #18's sluttræ, selv om squash betyder, at alle oprindelige commit-ID'er ikke er forfædre.

### Vedligeholdelse med CI-evidens

| PR | Base | Eksakt head SHA | Verificeret CI-run |
| --- | --- | --- | --- |
| [#32](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/32) | `main` | `e6196d367790ea48c979047c3d35b046eda94f85` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38563421794) |
| [#4](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/4) | `main` | `66788d2e379a57fc1eb0971185a46b31e65d438b` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38563475963) |
| [#24](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/24) | `main` | `a3df49fd354b001c6fbd881bed0bab5b7c7bdebf` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38563606311) |
| [#27](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/27) | `main` | `42a432c2890c1a67f32525342b715d2360ea984a` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38563549272) |
| [#14](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/14) | `main` | `0f53093323c70f990b59b3b9c94a74f27daa5c1c` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38392337236) |
| [#13](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/13) | `main` | `eaeeef540bc7a5c95934cf810f5ff7cae9e69164` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38392364851) |
| [#7](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/7) | `main` | `a7877e8a4e1cfa6f1a92b4f4e81dac39729e0377` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38392380484) |
| [#9](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/9) | `main` | `e0c3619d95af78c87c0f5a67ad88d8998bdc33f3` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38564134372) |
| [#6](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/6) | `main` | `0bf96d1616557574eea2bccf73953312052b2aa2` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38392366754) |
| [#33](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/33) | `main` | `42f27691723e6f536e608a847313b7a39b41d89f` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38564185371) |
| [#34](https://github.com/Parthee-Vijaya/DGITA_codereviewed/pull/34) | `feat/kle-in-application` | `8fec75347a9875f8d90d0a65d7306eee0222783e` | [13/13 bestået](https://github.com/Parthee-Vijaya/DGITA_codereviewed/actions/runs/38564670025) |

PR #13 krævede genkørsel af fejlede CI-jobs: en optaget port fik dev-serveren til at vælge en anden port, mens testharnessen ventede på den oprindelige. Seneste forsøg 3 er grønt. Dette er ikke registreret som en åben assertionsfejl, men en gentagelse bør udløse undersøgelse af portreservationen.

## 5. Anbefalet rækkefølge ved senere sammenfletning

**Dette er en plan, ikke autorisation til at merge nu.** Main skal fortsat bevares, indtil Parthee godkender næste frigivelsestrin.

1. Gennemgå vedligeholdelses-PR'erne i rækkefølgen **#32 → #4 → #24 → #27 → #14 → #13 → #7 → #9 → #6 → #33**. Opdater hver efter ændret base og lad friske checks bestå. Den mest følsomme pakke er database/React/CSS; deres samlede lokale prøve er allerede udført.
2. Brug **#29 som den samlede funktionelle kandidat** for etape 1–4 og KLE-grundlaget. Den omfatter det arbejde, der også er synligt gennem #18/#22/#23. Efter review og accepteret sammenfletning af #29 kan #18/#22/#23 afstemmes og lukkes som overhalede. De er ikke lukket i denne dokumentationsleverance. Merge ikke alle fire PR'er blindt som uafhængige leverancer.
3. Fortsæt funktionskæden **#29 → #30 → #31 → #34 → denne dokumentations-PR**. De aktuelle baser er forrige featurebranch. Når en forælder er flettet, kontrolleres ancestry og diff, og barnet målrettes den rigtige nye base med frisk CI. Særligt efter squash skal allerede indarbejdet kode ikke genintroduceres som nyt arbejde.
4. Hold #8 og #12 udenfor. De kræver hver sin kompatibilitetsleverance.
5. Gentag den samlede integration og de relevante browserprøver på den endelige kandidat. Den lokale integrationsbranch er et testbevis, ikke en genvej uden om de separate PR'er.

Der var konflikter i de nærliggende React-/Tailwind-linjer i manifest/lockfil under lokal integration. De blev løst med alle tilsigtede opgraderinger bevaret. Et uafhængigt strukturelt review fandt ingen uvedkommende forskelle i det samlede manifest eller lockfil. Ved en ny integration skal følgende især bevares: KLE-værktøjets `@xmldom/xmldom@0.9.12`, sikkerheds-overrides for sharp 0.35.5, source-map-js 1.2.2 og Drizzle-loaderens esbuild 0.25.12, samt ESLint 9.39.4 og TypeScript 5.9.3.

## 6. Hvad er faktisk verificeret?

### Samlet lokal kandidat

- Branch: `verify/dependency-updates-with-kle`.
- Eksakt SHA: `66adecb08aa28db038c2b5f2d03febf5825d0216`.
- Indhold: PR #31 med alle 11 vedligeholdelsesændringer, inklusive previewrettelsen i #34.
- Kandidaten er kun lokal og er ikke pushet eller tilbudt som en samlet merge-PR.

| Kontrol | Resultat og omfang |
| --- | --- |
| Ren installation | `npm ci` bestod med Node 24.19.0 og npm 11.17.0. |
| Statisk kontrol | Lint, typer og arkitektur-/kompleksitetsgrænser bestod. |
| Kode og database | **533/533 tests** bestod. Vedligeholdelsesrunden tilføjede tre libsql-tests; 533 er det samlede antal. |
| Builds | Både Worker/Vinext og Next-produktionsbuild bestod. |
| Browser | **39 forløb** bestod: 27 almindelige tilgængeligheds-/tastaturforløb og 12 særskilte KLE-forløb. KLE-forløbene er bevidst adskilt fra den almindelige suite. |
| Isolerede runtimes | `kle-preview`, `a11y`, `e2e`, `production` og `next-e2e` bestod. Alle registrerede samme rene, uændrede kilde-SHA ved start og slut. |
| Audit og SBOM | Ingen kendte fund blandt produktionsafhængighederne ved prøven. De 9 præcise udviklingsundtagelser er uændrede; det er ikke nul fund i hele dependency-træet. |
| Visuel sammenligning | Fire KLE-billeder var pixelidentiske med baseline: ansøgning desktop 1280×2938/mobil 390×3864 og separat KLE-preview desktop 1280×2769/mobil 390×3605. Billederne blev også visuelt gennemgået. |

Runtime-resultaterne indeholder `buildProvenance: not_attested_by_runtime_runner`: de dokumenterer ren kildeidentitet, men attesterer ikke alene et forudgående builds oprindelse. Buildlogs er separat evidens. Next-forløbet anvender lokale syntetiske provider-fixtures. Lokal `production`-test betyder ikke, at en deployment eller rigtig kommunal integration er accepteret. Den visuelle konklusion gælder de fire nævnte KLE-visninger, ikke alle sider.

Deploymentværktøjerne har en særskilt lockfil og auditpolitik; deres 21 undtagne udviklingsnoder skal også følges. De eksisterende braces-undtagelser udløber **4. november 2026 kl. 00.00 UTC**. Se [værktøjsgæld](docs/tooling-debt.md) og de aktuelle politikker før enhver release.

### Evidensens placering

GitHub-runlinks i afsnit 4 er delbare beviser for hver enkelt PR. Artefakter har begrænset opbevaringstid; eksportér nødvendige, redigerede beviser til et godkendt evidenslager før udløb. Følgende er lokale genfindingsstier på Parthees Mac og findes ikke automatisk i en ny klon:

- Samlet testcheckout: `/Users/parthee/.codex/worktrees/dgita-dependency-integration`.
- Logs: checkoutets `work/maintenance-*.log`, `work/maintenance-health.json`, `work/maintenance-sbom.json` og `work/ci/<mode>/result.json`.
- Leverancemappe: `/Users/parthee/Documents/Codex/2026-10-05/github-plugin-github-openai-curated-remote/outputs/DGITA-maintenance-2026-10-14`.
- I leverancemappen: `status.json`, `github-verification.json`, `handoff-github-snapshot.json`, `DGITA-PR-status-2026-10-14.csv`, `baseline/`, `after/` og de anvendte `pr-<nummer>-body.md`.

Den tidligere mappe `outputs/DGITA-PR-review-2026-10-14` beskriver anbefalingerne **før** lukninger/opdateringer; dens “kun gennemgang”-status er historisk og må ikke bruges som den aktuelle handlingsstatus.

## 7. Data, migrationer og miljøgrænser

- **Migration 0007** tilføjer intern vurderingshistorik. Den er additiv; historikken begynder ved nye gemninger og rekonstruerer ikke gamle værdier. Normal appdrift kan ikke ændre/slette den.
- **Migration 0008** tilføjer register og historik for systemanvendelser. SQL-grænserne kræver aktuelt syntetisk kilde og tomme KITOS-identiteter; rigtig KITOS-binding kræver en ny kontrolleret schema-/datamodelændring. Bevar manifest, checksums og versionsbinding. KLE i ansøgningen bruger et additivt felt i den eksisterende datarepræsentation og kræver ikke en ny migration efter 0008.
- Migration og dataovergang skal afprøves på en relevant, kontrolleret kopi før et rigtigt miljø. Ingen manuel godkendelse af en forkert checksum-ledger, ingen automatisk konvertering af gamle fritekstfelter til verificerede KLE-valg.
- Lokal KLE kræver alle fire forhold: `DGITA_ENVIRONMENT=local`, `DGITA_ENABLE_DEV_LOGIN=true`, `DGITA_ENABLE_KLE_PREVIEW=true` og `DGITA_APP_ORIGIN` på loopback. Host/origin skal passe, og brugeren skal have en aktiv lokal testidentitet. API'et håndhæver samme grænse og private svar uden cache. Pilot/produktion afviser KLE-afprøvnings-API'et og nye strukturerede eksempelvalg.
- **Deaktivering/rollback af KLE:** Fjern først strukturerede eksempelvalg fra kladder, der fortsat skal kunne redigeres uden preview; serveren afviser ellers gemning af disse valg. Bevar læseunderstøttelse for indsendte snapshots og gemte kvitteringer ved kode-rollback. Omskriv ikke tidligere indsendte versioner eller PDF-bytes, og slet ikke historik som kode-rollback.
- Aktiv søgeprovider er eksplicit syntetisk. En miljøvariabel eller klientparameter kan ikke aktivere officielle data. En SHA-256 eller en klargjort katalogfil er ikke brugsaccept.
- Preview-workflowet har en isolationskontrol og kræver egne godkendte ressourcer. Det eksisterende releaseworkflow anvender production-target også ved miljøvalget “pilot”; det er ikke en sikker genvej til en ny preview.
- Testlogin og automatisk demo-seed afvises i produktion. Offentlig testadgang skal bruge den eksisterende adgangsbeskyttelse og syntetiske identiteter. Bevar den gamle pilot indtil en særskilt overgangsbeslutning.
- Retention er en reviewberegning, ikke et aktivt slettejob. Restore er i karantæne og må ikke genaktivere gamle sessioner, godkendelseslinks eller mails automatisk.

## 8. Restopgaver og anbefalet næste udvikling

### Først: luk review- og beslutningshuller

1. Gennemgå de 11 grønne vedligeholdelses-PR'er og den overlappende funktionskæde efter afsnit 5. Udfør ingen merge alene ud fra denne handoff.
2. Udpeg menneskelig systemejer, faglige acceptansvarlige og uafhængig reviewer/frigiver (R02). Få konkret beslutning om rollemodel, egne sager, lederidentitet og genindsendelse (F23, R05/R06, F11/F12).
3. Indhent det autoritative kravgrundlag (F05), faglig accept af databeskyttelsesvurderingen (F13) og indkøbspolitik/tærskler med gyldighed samt overdragelse til indkøb (F14). Implementér derefter de accepterede vurderings-/afslutningsregler i F15; slå ikke nye juridiske blokeringer til på et uafklaret grundlag.

### KLE/NIS2/KITOS: næste leverancer

ID'erne herunder hører til [KLE-planen](docs/implementation/kle-system-lifecycle-plan.json). De må ikke forveksles med de ældre K01–K12-produktionskandidatpakker i `candidate-readiness.md`.

| Planpunkt | Resterende arbejde og acceptkriterium |
| --- | --- |
| K01 | Den isolerede samling er implementeret. Review og senere merge er stadig ikke udført. |
| K02–K04 | Prototype findes. Afklar stabil KITOS-binding og relation til flere anskaffelsessager, kildegrundlag og reelle rettigheder. Registrantbekræftelse er ikke formel ejeraccept. |
| K05 | Få skriftligt afklaret KL-brugsgrundlag. Afprøv en autoriseret, aktuel eksport mod importeren; kontrollér UUID, hierarki, stikord, udgåede emner og versionsdiff. Byg kontrolleret publicering af accepteret katalog samt historiske versioner. Flyt evaluering/opslag af valgte poster til serveren før et fuldt officielt katalog bruges. |
| K06 | Godkend den særskilte KL-opgavekilde, sidehenvisninger og kontrolleret konvertering. KLE og KL-opgavematch er forskellige kilder; et KLE-emne udløser ikke automatisk et NIS2-match. |
| K07 | Verificér organisation-/anvendelses-UUID og KITOS-feltmapping, lokale tilføjelser/fravalg og eksisterende kritikalitet. Start med læsning/ændringsforslag og datakontrakt. |
| K08 | Definér ejer, stedfortræder og koordinator med stabile identiteter, gyldighed og mandat. Et navn eller en sagsansøger giver ikke fuldmagt. |
| K09 | Gennemfør manuel pilot på 10–15 systemanvendelser efter kilde-/adgangsafklaring; mål oversete opgaver og tidsforbrug, og medtag delte login/integrationer og manglende ejer. |
| K10 | Byg årscyklus, frister, ejerskifte, gentagelsessikre job og eskalation efter rollebeslutningen. Manglende svar må aldrig blive en bekræftelse. |
| K11 | Definér versionerede kravprofiler med scope, periode, dokumentationsstatus og mandat til afvigelser. Certifikater må ikke automatisk godkende en anvendelse. |
| K12 | Byg versionsbundne SHIELD-eksport-/importpakker med hash, sags-/anvendelsesversion, forældelsesstatus og genforsøg. DGITA bevarer den lokale beslutning. |
| K13 | Etablér menneskeligt mærket testsæt og mål kvalitet før AI-forslag/JEV-kontrol; bevar kildebevis og manuel reservevej. |
| K14 | Først efter integrationsbevis: kontrolleret KITOS-skrivning med præcis ændringsliste, feltansvar, samtidighed, konflikter, retries og readback. Ingen overskrivning af andres felter. |
| K15 | Afklar adgang, bevaring/sletning, aftaler, drift, backup og miljøaccept før rigtige data. |

Det næste kodearbejde kan forberede versioneret kravkatalog og kontrolleret KLE-publicering som adskilte branches uden at aktivere uafklarede regler eller officielle data. Kilder, mandat og accept skal indhentes parallelt. Bevar ansøgningens eksisterende UX og den valgfrie konsulenthjælp.

### Øvrige funktioner, som stadig mangler helt eller delvist

- **F02/F03:** Autoritativ person-/afdelingskilde, katalogets opdateringsansvar og aktualitet. De nuværende identitets- og relationsfelter er implementeret, men lukker ikke kildeaccepten.
- **F04:** Hjælpehenvendelser før ansøgning. Dette er en særskilt backlogfunktion; den må ikke genindføre den fravalgte KLE-delingsfunktion.
- **F05/F06/F15:** Kravkatalog, kvalitetsmålt AI-gennemgang af databehandleraftaler og særskilt juridisk DBA-/risikoaccept.
- **F07–F09:** Redigerbare felttitler/krav/fejlbeskeder, kommunal redaktør med adskilt fælles/lokalt ejerskab og FAQ-rækkefølge/placering.
- **F16:** Underskrift og overdragelse til drift/kontraktstyring med modtager, journalreference og ansvar.
- **F19–F21:** Resterende kommunale tekster/links, korrekte nyhedsgenveje, milepæle og tydelig adskillelse af de to brugerantal.
- **F24:** Komplet paritetsprøve mod den gamle løsning og afstemt, gentagelig migration af rigtige sager/bilag/journalreferencer.
- **Teknisk leverede F01/F10–F13/F17/F18/F22:** Samlet review og den relevante proces-/faglige accept skal stadig registreres. Kodestatus er ikke kommunal accept.

### Drift, tilgængelighed, ISO, NIS2 og databeskyttelse

| Planområder | Hvad mangler før accept? |
| --- | --- |
| R01–R07 | Platform og anvendelsesramme, ansvar/frigiver, isoleret testmiljø, secrets/offentlig adgang, rigtig kommunal identitet, lederidentifikation og uafhængig sikkerhedstest. |
| R08 | Håndtering af braces-gæld før undtagelsernes udløb, og særskilt kompatibilitetsarbejde for ESLint/TypeScript. Ingen automatisk forlængelse af undtagelser. |
| R09–R12 | Faktisk privat storage inkl. browser/CORS, malwaretjeneste, Graph/maillevering, scheduler/køkapacitet og afstemning ved uklar levering. |
| R13–R14 | Fortsat opdeling af store moduler og risikobaseret dækning af udækkede grene. De eksisterende målte kontroller bevares. |
| R15–R17 | Miljøaccept af den implementerede previewvej, promotion/rollback og en afprøvet dataovergang. Azure/Hetzner er ikke implementerede deployveje; repositoryets releasevej er Vercel. |
| R18–R20 | Rigtig backup, aftalte RPO/RTO, samlet restoreøvelse og sikker genåbning efter karantæne. |
| R21–R24 | Manuel VoiceOver/NVDA-afprøvning for rollerne, faktisk browserzoom, accepteret produktions-PDF og brugeraccept. Tagged-PDF-prototypen er ikke godkendt PDF/UA. |
| R25–R28 | Accepteret formål/feltgrundlag, relevante aftaler/dataplacering/exit, brugbar information og rettighedsforløb samt gennemgang af platformlogs, mailkopier og retention. |
| R29–R32 | Autoritativ journal, bevaring/kassation/hold, serveradapter til autoritative bevaringsdata og kvitteret journal-/arkiveksport. Arkivering/sletning kræver særskilt accepteret proces og mandat. |
| R33–R36 | Ekstern overvågning og vagt, kapacitets-/leverandørsvigtprøve, faktisk hændelsesøvelse og driftsoverdragelse. |
| R37–R40 | Forankring i sikkerhedsledelse/ISMS, konkret NIS2-scope og hændelsesvej, reviewede miljøbeviser og menneskelig frigivelsesbeslutning. |

De eksisterende 18 miljøacceptscenarier er ikke automatisk accepteret af denne runde. ISO-/NIS2-/databeskyttelsesscore hæves ikke på grundlag af flere felter, grøn CI eller denne handoff. De juridiske og organisatoriske forhold skal vurderes og accepteres af de udpegede ansvarlige.

### Kendte mindre restopgaver

- Ret den nævnte tidsmæssige uoverensstemmelse mellem `kle-search.md` og `kle-application.md` ved næste dokumentationsopdatering.
- Worker-preview har en kendt `next/font/local`-shimbegrænsning og bruger fallbackskrifttype på berørte ruter. Pixelidentiske billeder viser bevaret baseline, ikke at fontproblemet er løst. Verificér rod-/underruter og normal Next-runtime ved rettelsen.
- Bevar den snævre udviklingsadapter for `console.createTask`, indtil en låst upstreamversion er afprøvet og erstatter den. Se [værktøjsgæld](docs/tooling-debt.md).
- Gem nødvendige CI-artefakter og billedbeviser i et aftalt evidenslager; de lokale filer og kortlivede GitHub-artefakter er ikke et permanent fælles arkiv.

## 9. Sikker genoptagelse og genkørsel

Den lokale preview kørte ved handoff på `http://127.0.0.1:4339` fra `/Users/parthee/.codex/worktrees/dgita-kle-lifecycle`, branch `feat/kle-in-application`, SHA `a9edc1d5c904feb215ff6657eb1d081e7987bb1e`. `GET /api/healthz` svarede `{"status":"ok"}`. Previewen blev ikke genstartet eller flyttet til dependency-kandidaten. Det er en lokal adresse og ikke en offentlig leverance.

Bevar følgende checkoutfamilie; fjern eller nulstil ikke mapper som en automatisk del af fortsættelsen:

| Lokal mappe under `/Users/parthee/.codex/` | Formål |
| --- | --- |
| `dgita-stage3-recovery` | Tidligere assessment-arbejde, `feat/privacy-and-procurement-assessments`. |
| `worktrees/dgita-kle-lifecycle` | Kørende KLE-preview, PR #31. |
| `worktrees/dgita-dependency-maintenance` | Preview-workflowrettelse, PR #34. |
| `worktrees/dgita-libsql-review` | Libsql-opdatering og de tre nye tests, PR #9. |
| `worktrees/dgita-tailwind-update` | Samlet Tailwind/PostCSS, PR #33. |
| `worktrees/dgita-dependency-integration` | Lokal samlet testkandidat; ikke pushet. |
| `worktrees/dgita-final-handoff` | Denne dokumentationsbranch. |

Start med `git status`, `git fetch origin`, branch/upstream og aktuel PR-status. Vælg et rent, separat checkout til integration og test. Brug Node **24.19.0**, npm **11.17.0** og lockfiler; den lokale runtime findes under `/Users/parthee/.codex/runtime/node-v24.19.0-darwin-arm64/bin`. Brug ikke systemets eventuelle Node 26 til at genskabe disse målinger.

Kør fra samme rene, committede kandidat:

```sh
npm ci
npm run lint
npm run typecheck
node scripts/code-health.mjs --check
npm test
npm run build:next
node scripts/ci-audit.mjs
npm sbom --sbom-format=cyclonedx
PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright npx playwright install chromium
npm run test:ci:kle-preview
npm run test:ci:a11y
npm run test:ci:e2e
npm run test:ci:production
npm run test:ci:next-e2e
```

`npm test` bygger Worker før kode-/databasetest. Next-build skal være fra samme kandidat som de efterfølgende runtimeprøver. Hold runtimeprøverne isolerede; de afviser beskidt/ændret kilde. Deployværktøjer, secretscan, workflowvalidering og CodeQL dækkes desuden af den aktuelle GitHub Quality gates-kørsel. Se [CI/CD](docs/ci-cd.md), [kandidatgrundlag](docs/candidate-readiness.md) og [miljøaccept](docs/municipal-acceptance.md) for de øvrige releasekrav. Ingen credentials eller rå miljøfiler må tilføjes til Git.

## 10. Autoritative planer og statusoversigt

- [64-punktsplanen](docs/implementation/plan.json) beskriver R01–R40 og F01–F24 med handlinger, acceptkrav og kildehenvisninger. Status nedenfor er kopieret fra den aktuelle funktionsbranch; ingen af de 64 opgaver har registreret `accepted_by`. Denne handoff ændrer ikke deres acceptstatus.
- [KLE-planen](docs/implementation/kle-system-lifecycle-plan.json) beskriver K01–K15 og sammenhængen til grundplanen. Den leverede DOCX-feedbackplan er brugt som kilde og er ikke redigeret.
- [Kontrolregister](docs/governance/control-register.json), [miljøacceptregister](docs/governance/environment-acceptance.json), [produktion/drift](docs/production-operations.md), [tilgængelighed](docs/accessibility-testing.md) og [datainventar](docs/privacy/data-inventory.json) er de detaljerede kilder til accept og drift.
- Live Git/PR-heads og den faktisk kørende kode går forud for gamle datoer og snapshots. Ældre scores eller en grøn check må ikke udlægges som nuværende produktionsaccept.

| ID | Opgave | Registreret status pr. 14. oktober 2026 |
| --- | --- | --- |
| R01 | Vælg platform og anvendelsesramme | Planlagt |
| R02 | Udpeg ejere og uafhængig frigiver | Planlagt |
| R03 | Etablér et isoleret testmiljø | Planlagt |
| R04 | Fastlæg secrets og offentlig adgang | Planlagt |
| R05 | Afprøv kommunens rigtige identitet | Planlagt |
| R06 | Beslut hvordan lederen identificeres | Planlagt |
| R07 | Gennemfør uafhængig sikkerhedstest | Planlagt |
| R08 | Luk den resterende værktøjsgæld | Delvist implementeret |
| R09 | Afprøv privat fillager fra browseren | Planlagt |
| R10 | Tilslut en godkendt malwaretjeneste | Planlagt |
| R11 | Accepter rigtig maillevering | Planlagt |
| R12 | Fastlæg og afprøv scheduler og kø | Planlagt |
| R13 | Fortsæt opdelingen af store moduler | Planlagt |
| R14 | Udvid test af de udækkede risikogrene | I gang |
| R15 | Byg en entydig vej til preview | Kode implementeret; miljøaccept mangler |
| R16 | Øv promotion og tilbageførsel | Planlagt |
| R17 | Planlæg overgang fra eksisterende data | Planlagt |
| R18 | Etablér backup med aftalte mål | Planlagt |
| R19 | Udfør en samlet gendannelsesøvelse | Planlagt |
| R20 | Beskriv og afprøv sikker genåbning | Planlagt |
| R21 | Ret resterende felter og afprøv alle roller | I gang |
| R22 | Test faktisk zoom og visuelle behov | Planlagt |
| R23 | Færdiggør den rigtige produktions PDF | Planlagt |
| R24 | Gennemfør brugeraccept og dokumentér scope | Planlagt |
| R25 | Godkend formål felter og datagrundlag | Planlagt |
| R26 | Afklar aftaler dataplacering og exit | Planlagt |
| R27 | Gør information og rettighedsforløb brugbare | Planlagt |
| R28 | Kontrollér logs og eksterne kopier | Planlagt |
| R29 | Vælg den autoritative journal | Planlagt |
| R30 | Vedtag bevaring kassation og hold | Planlagt |
| R31 | Forbind bevaringsberegningen med autoritative data | Planlagt |
| R32 | Afprøv kvitteret journal og arkiveksport | Planlagt |
| R33 | Tilslut ekstern overvågning og vagt | Planlagt |
| R34 | Mål kapacitet og leverandørsvigt | Planlagt |
| R35 | Gennemfør en fælles hændelsesøvelse | Planlagt |
| R36 | Gennemfør driftsoverdragelse og oplæring | Planlagt |
| R37 | Forankr kontrollerne i sikkerhedsledelsen | Planlagt |
| R38 | Afklar NIS2 ansvar og hændelsesvej | Planlagt |
| R39 | Ajourfør dokumentation og saml acceptbeviser | I gang |
| R40 | Træf frigivelsesbeslutning og følg op | Planlagt |
| F01 | Beskrivelse af infrastrukturændringer | Implementeret; afventer samlet review |
| F02 | Person- og afdelingsopslag samt flere ansvarlige | Delvist implementeret |
| F03 | KITOS-opslag ved erstatning og tilkøb | Kode implementeret; kildeaccept mangler |
| F04 | Hjælpehenvendelser før en ansøgning | Planlagt |
| F05 | Struktureret katalog over databehandlerkrav | Planlagt |
| F06 | AI-assisteret gennemgang af databehandleraftaler | Planlagt |
| F07 | Redigerbare felttitler, feltkrav og fejlbeskeder | Planlagt |
| F08 | Kommunal redaktør og fælles kontra lokale links | Planlagt |
| F09 | FAQ-rækkefølge og placering | Planlagt |
| F10 | Konsulentens arbejdsfiltre | Implementeret; afventer samlet review |
| F11 | Konsulenten skal kunne bede om rettelser | Implementeret i kode; procesaccept udestår |
| F12 | Entydig regel for ledergodkendelse før afslutning | Implementeret i kode; procesaccept udestår |
| F13 | Databeskyttelsesvurdering med konkret hjemmel | Implementeret i kode; faglig accept udestår |
| F14 | Aftaleværdi og vej til indkøbsfunktionen | Delvist implementeret; indkøbsaccept udestår |
| F15 | Risikovurdering og særskilt juridisk DBA-accept | Planlagt |
| F16 | Underskrift og overdragelse til drift/kontraktstyring | Planlagt |
| F17 | Screening af anskaffelser med AI | Implementeret i kode; faglig accept udestår |
| F18 | Afpublicering skal faktisk skjule CMS-indhold | Implementeret; afventer samlet review |
| F19 | Ret vejledning, kontaktlinks og statusløfter | Delvist implementeret |
| F20 | Genveje til nyheder og kommuneinformation | Planlagt |
| F21 | Milepæle og to forskellige brugerantal | Planlagt |
| F22 | Ensartet validering og filvejledning | Implementeret; afventer samlet review |
| F23 | Bevidst rollemodel for admin og konsulent | Afventer procesvalg |
| F24 | Paritetsprøve og flytning af eksisterende sager | Planlagt |
