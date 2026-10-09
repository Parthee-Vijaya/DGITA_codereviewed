# Værktøjsgæld, kontrolleret 9. oktober 2026

## Sikkerhedsrettelser 9. oktober 2026

En ny audit viste 13 high-fund i det samlede træ og 2 high-fund blandt produktionsafhængighederne. De to nye advisories vedrørte `sharp@0.35.4` og `source-map-js@1.2.1`, som også nås via Next. De er rettet med præcise patch-overrides: `sharp@0.35.4 → 0.35.5` og `source-map-js@1.2.1 → 1.2.2`. Sharp-patchen opdaterer tilhørende native pakker og libvips. Ingen direkte framework-, React-, Node- eller majorversion er ændret.

Første rettede versioner er verificeret i de primære advisories: [sharp GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) og [source-map-js GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). En ren installation af den nye lockfil er kontrolleret på Node 24. `tests/dependency-security-compatibility.test.mjs` afprøver faktisk SVG/PNG-dekodning, gyldige source maps og afvisning af urimelige/ugyldige sektionsoffsets. De samlede applikationsbuilds og regressionstests skal fortsat bestå på samme kandidat.

Efter patchene er produktionsaudit tilbage på **0 fund**. Det samlede træ har **8 high-pakkenavne / 9 installnoder**, alle fra den eksisterende braces-advisory. Deploymentværktøjets særskilte lockfil er ikke berørt af de to nye advisories og er bevaret; den har **21 high-pakkenavne / 21 installnoder** fra braces, og CLI-kompatibilitetstesten består. Begge auditpolitikker består uden nye eller udvidede undtagelser. Braces-undtagelsernes udløb er fortsat **4. november 2026 kl. 00.00 UTC**.

Der findes fortsat ingen officielt udgivet patch til [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); npm-registryets nyeste version er 3.0.3. `npm audit fix --force` foreslår blandt andet nedgradering af Nexts lintpakke og vinext. Det er ikke en kompatibel, snæver patch og anvendes ikke. `brace-expansion` er en anden pakke og lukker ikke denne braces-advisory.

## Tidligere esbuild-rettelse

Den afgrænsede override gælder kun `@esbuild-kit/core-utils@3.3.2 → esbuild@0.25.12`. Den erstatter det gamle esbuild 0.18.20 under Drizzle-loaderen med samme rettede minorserie, som Drizzle-kit allerede bruger direkte. Fordi loaderens deklarerede range er ældre, kræves den udførte kompatibilitetstest; ændringen er ikke en påstand om upstreams officielle support af overriden.

`tests/tooling-compatibility.test.mjs` kører både synkron og asynkron TypeScript-transform gennem den faktiske loader og genererer/validerer repositoryets Drizzle-schema i en disponibel mappe. De eksisterende migrationsprøver kontrollerer genkørsel, rollback, constraints og checksums. Den gamle esbuild-undtagelse er fjernet fra auditpolitikken. [Advisoryen](https://github.com/advisories/GHSA-67mh-4wv8-2f99) angiver 0.25.0 som første rettede version.

Ved kontrollen 5. oktober efter esbuild-rettelsen: `npm audit --omit=dev` havde 0 fund; fuld audit har 8 high og 0 moderate/critical. De resterende fund er alle direkte eller transitive følger af [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), i alt 9 præcise dependency-noder. Registryets nyeste braces er 3.0.3, og advisoryen angiver ingen rettet version. En generel override eller skjult omklassificering løser derfor ikke den resterende risiko.

Braces bruges i build/lint-globmatchning, ikke i produktionsafhængighederne. De eksisterende isolerede CI-jobs har tidsgrænser og ingen produktionscredentials. Undtagelsen er fortsat afgrænset til advisory, package-version og node; udløb 4. november 2026 er uændret. Nye/ændrede fund eller udløb stopper gaten. Hvis der ikke kommer en understøttet patch inden fristen, kræves særskilt valg mellem dokumenteret værktøjsudskiftning og en reviewet vedligeholdt fork. K03 er dermed delvist lukket i kode; braces-gælden står åbent med konkret upstreamblokering.

## Workers udviklingsrendering

En ren installation reproducerede en HTTP 500 i lokal Workers-rendering: runtime eksponerede `console.createTask`, men kaldet kastede en ikke-implementeret-fejl. Reacts udviklingsbuild brugte metoden efter en eksistenskontrol. Fejlen er rapporteret i [vinext #3234](https://github.com/cloudflare/vinext/issues/3234), med et åbent upstream-rettelsesforslag [#3233](https://github.com/cloudflare/vinext/pull/3233), verificeret 5. oktober 2026.

`build/workerd-dev-console.mjs` er en midlertidig, udviklingsafgrænset Vite-adapter for vinexts server-globals i RSC og SSR. Den afprøver den valgfrie debugfunktion og behandler kun en ubrugelig funktion som fraværende. Den ændrer ikke almindelige logs, fungerende tracing, browserkoden eller produktionsbuild. Både negative enhedstest og det faktiske lokale Worker-forløb skal bestå. Fjern adapteren, når en låst upstream-udgave løser problemet, og gentest efter en ren installation.
