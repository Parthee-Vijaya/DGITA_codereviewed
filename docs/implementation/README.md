# Gennemførelse af DGITA-planen

Planen samler R01–R40 og F01–F24. Den fulde opgaveliste med handlinger, acceptkrav og status findes i [plan.json](plan.json). Opgaver lukkes individuelt på konkrete beviser; lokal kodeverifikation er ikke kommunal driftsaccept.

## Første leverance · 9. oktober 2026

Den eksisterende visuelle retning, CSS, navigation og formularens ti trin bevares. Første leverance retter afpublicering, tilføjer den interne infrastrukturbeskrivelse med revisionshistorik og samler input-/uploadvalidering. Kontaktknapper bruger samme redaktionelle e-mailadresse, og "Samtykke" i sagsgennemgangen hedder "Bekræftelse af oplysninger".

Afpublicerede tekster sendes ikke til bruger/konsulent. En tom markør forhindrer, at standardtekst genopstår. CMS-indhold vises først efter et vellykket opslag for den aktuelle bruger/rolle/kommune; fejl kan genprøves. Administrator kan fortsat redigere og genpublicere.

Eksisterende indhold, brugerdata, sagsversioner, PDF-filer og onlinepilot ændres ikke af lokale prøver. Standardtekstens udokumenterede 3–5-minuttersløfte er rettet for nye installationer; eksisterende kommunale tekster gennemgås redaktionelt. Kontakt · e-mail under Portaltekster er fælles kilde for mailknapper og kontaktgenvejen. Den særskilte kontaktgenvejs gamle URL overskrives ikke i databasen; editoren forklarer den fælles kilde.

Infrastrukturbeskrivelsen er intern og kommer ikke i brugerens afgørelse eller kvittering. En udvidet modtagerkreds kræver konkret procesaccept. Den additive migration 0007 tilføjer [intern vurderingshistorik](../privacy/review-history.md); migration, manifest, adgang og rollback af en fejlet gemning er testet. Tidligere tabt historik bliver ikke opfundet.

Nye fund i sharp og source-map-js er rettet med snævre patch-overrides. De eksisterende tidsbegrænsede braces-undtagelser er uændrede; se [værktøjsgæld](../tooling-debt.md). Den nye [previewvej](../ci-cd.md) kræver egne ressourcer og stopper uden dokumenteret opsætning. Ingen eksterne miljøflag eller deployment er udført som del af første leverance.

## Verifikation

Brug Node 24 og `npm ci`. Kør lint, typecheck, `npm test`, `npm run build:next`, de fire `test:ci:*`-forløb samt auditpolitikkerne. Runtimeprøver kræver et rent committet checkout. `tests/a11y/plan-improvements.spec.ts` afprøver afpublicering/indlæsningsfejl og konsulentens nye felt i browseren. `tests/review-history.test.mjs` afprøver historik, versionsskift, adgang og transaktionsfejl. `scripts/ci-preview.test.mjs` afprøver isolationsgrænser. Aktuel CI-status knyttes til den konkrete PR/SHA.

Før/efter-billeder og lokale logfiler ligger i checkoutets ignorerede `work/implementation/`. De er lokale QA-beviser, ikke produktionsdata. Visuel kontrol omfatter brugerforside, formular, konsulent, administration og mobil. Uændret CSS alene er ikke tilstrækkeligt bevis for bevaret UX; indlæsning, validering, gemning og genindlæsning testes også.

## Næste leverance

Fortsæt med rolle-/identitetsgrundlag og konsulentens arbejdsfiltre (F02/F03/F10/F23), derefter de adskilte beslutninger og rettelsesflow (F11–F17). Udbyg konkrete delresultater i parallelle pakker; en hel pakke skal ikke være færdig, før en anden starter. F05-kravgrundlaget skal dog eksistere før F15 kan accepteres.

B01–B08 i den godkendte gennemførelsesplan er anbefalinger, ikke allerede vedtagne kommunale regler. Fastlæg især platform/identitet, egne sager, ledermandat, genindsendelsesregler, juridiske krav, journal og bevaring før berørte produktionsregler aktiveres. AI-analyse forbliver en særskilt leverance med målt kvalitet og menneskelig beslutning. Navngiv menneskelige ejere og uafhængig frigiver før kalender og driftsaccept fastlåses.
