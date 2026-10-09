# Gennemførelse af DGITA-planen

Planen samler R01–R40 og F01–F24. Den fulde opgaveliste med handlinger, acceptkrav og status findes i [plan.json](plan.json). Opgaver lukkes individuelt på konkrete beviser; lokal kodeverifikation er ikke kommunal driftsaccept.

## Første leverance · 9. oktober 2026

Den eksisterende visuelle retning, CSS, navigation og formularens ti trin bevares. Første leverance retter afpublicering, tilføjer den interne infrastrukturbeskrivelse med revisionshistorik og samler input-/uploadvalidering. Kontaktknapper bruger samme redaktionelle e-mailadresse, og "Samtykke" i sagsgennemgangen hedder "Bekræftelse af oplysninger".

Afpublicerede tekster sendes ikke til bruger/konsulent. En tom markør forhindrer, at standardtekst genopstår. CMS-indhold vises først efter et vellykket opslag for den aktuelle bruger/rolle/kommune; fejl kan genprøves. Administrator kan fortsat redigere og genpublicere.

Eksisterende indhold, brugerdata, sagsversioner, PDF-filer og onlinepilot ændres ikke af lokale prøver. Standardtekstens udokumenterede 3–5-minuttersløfte er rettet for nye installationer; eksisterende kommunale tekster gennemgås redaktionelt. Kontakt · e-mail under Portaltekster er fælles kilde for mailknapper og kontaktgenvejen. Den særskilte kontaktgenvejs gamle URL overskrives ikke i databasen; editoren forklarer den fælles kilde.

Infrastrukturbeskrivelsen er intern og kommer ikke i brugerens afgørelse eller kvittering. En udvidet modtagerkreds kræver konkret procesaccept. Den additive migration 0007 tilføjer [intern vurderingshistorik](../privacy/review-history.md); migration, manifest, adgang og rollback af en fejlet gemning er testet. Tidligere tabt historik bliver ikke opfundet.

Nye fund i sharp og source-map-js er rettet med snævre patch-overrides. De eksisterende tidsbegrænsede braces-undtagelser er uændrede; se [værktøjsgæld](../tooling-debt.md). Den nye [previewvej](../ci-cd.md) kræver egne ressourcer og stopper uden dokumenteret opsætning. Ingen eksterne miljøflag eller deployment er udført som del af første leverance.

## Anden leverance · 9. oktober 2026

Personvalgene bruger nu stabile identiteter og særskilte ekstra ansvarlige. Erstatning/tilkøb har katalogvalg eller en begrundet manuel vej. Konsulenten kan kombinere arbejdsstatus, ansvar, fase og søgning; CSV følger samme liste. Åbne lederanmodninger har en eksplicit tilbagekald-knap, og den interne vurdering følger serverens lås også ved udløb. Se [personvalg, katalogrelationer og arbejdsfiltre](people-catalog-and-filters.md) for definitioner, kompatibilitet og resterende accept.

F02 er delvist leveret: autoritativ organisationskilde og afdelingsopslag udestår. F03 mangler accept af katalogets aktualitet og opdateringsansvar. F10 er teknisk leveret til review. F23-rolleforslaget afventer procesvalg; de eksisterende roller og egenbehandlingsregler er bevaret.

## Tredje leverance · 9. oktober 2026

Retur med manglende oplysninger og endeligt afslag er adskilte handlinger under sagens Overblik. Anmoderen ser en offentlig begrundelse og frist og kan genindsende en ny version. Endeligt afslag kræver særskilt bekræftelse og lukker sagen. En positiv D-GITA-beslutning kræver dokumenteret ledergodkendelse af den aktuelle version. Samtidige ændringer kontrolleres, og tidligere versioner, bilag og kommentarer bevares. Se [rettelses- og beslutningsflowet](correction-workflow.md).

AI-spørgsmålet ligger i det eksisterende trin 6, Risiko & data, med manuelt formål og valgfri vurderingsreference. Konsulenten kan filtrere og eksportere efter Ja, Nej, Ved ikke og Ikke besvaret. Gamle svar bliver ikke opfundet. Se [AI-screening](ai-screening.md). Ingen automatisk klassifikation eller nye eksterne AI-kald indføres.

F11/F12/F17 er teknisk implementeret til review; kommunal proces-, mandat- og faglig accept udestår. F23-rollevalget er fortsat åbent. De eksisterende roller, formularens ti trin, navigation og visuelle stil bevares. Der kræves ingen ny migration i etape 3.

## Verifikation

Brug Node 24 og `npm ci`. Kør lint, typecheck, `npm test`, `npm run build:next`, de fire `test:ci:*`-forløb samt auditpolitikkerne. Runtimeprøver kræver et rent committet checkout. `tests/a11y/plan-improvements.spec.ts` afprøver afpublicering/indlæsningsfejl og konsulentens nye felt i browseren. `tests/review-history.test.mjs` afprøver historik, versionsskift, adgang og transaktionsfejl. `scripts/ci-preview.test.mjs` afprøver isolationsgrænser. Etape 2 dækkes af `tests/responsible-directory.test.mjs`, `tests/catalog-relations.test.mjs`, `tests/case-detail-relations.test.mjs` og `tests/case-filters.test.mjs` samt browserprøverne `assignment-work-filters.spec.ts` og `catalog-relations.spec.ts`. Aktuel CI-status knyttes til den konkrete PR/SHA.

Etape 3 dækkes af `tests/correction-workflow.test.mjs`, `features/application/ai-screening.test.mjs` og browserprøverne `ai-screening.spec.ts`, `case-decisions.spec.ts` og `case-version-refresh.spec.ts`. De kontrollerer også offentlig kontra intern tekst, versionsbundne kvitteringer, samtidige ændringer uden tab af indtastning og indlæsning af den nye version via notifikation til samme åbne sag.

Før/efter-billeder og lokale logfiler ligger i checkoutets ignorerede `work/implementation/` og `work/ci/`. De er lokale QA-beviser, ikke produktionsdata. Visuel kontrol omfatter brugerforside, formular, konsulent, administration og mobil. Uændret CSS alene er ikke tilstrækkeligt bevis for bevaret UX; indlæsning, validering, gemning og genindlæsning testes også.

## Næste leverance

Fortsæt med F13/F14: konkret databeskyttelsesvurdering og aftaleværdi/indkøbsvej. Indhent samtidig det autoritative F05-kravgrundlag før F15 kan accepteres. F23-procesvalget og den resterende person-/organisationskilde under F02 skal fortsat afklares. Udbyg konkrete delresultater i parallelle pakker; en hel pakke skal ikke være færdig, før en anden starter.

B01–B08 i den godkendte gennemførelsesplan er anbefalinger, ikke allerede vedtagne kommunale regler. Fastlæg især platform/identitet, egne sager, ledermandat, genindsendelsesregler, juridiske krav, journal og bevaring før berørte produktionsregler aktiveres. AI-analyse forbliver en særskilt leverance med målt kvalitet og menneskelig beslutning. Navngiv menneskelige ejere og uafhængig frigiver før kalender og driftsaccept fastlåses.
