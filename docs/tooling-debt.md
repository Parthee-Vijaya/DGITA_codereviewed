# Værktøjsgæld, kontrolleret 5. oktober 2026

Den afgrænsede override gælder kun `@esbuild-kit/core-utils@3.3.2 → esbuild@0.25.12`. Den erstatter det gamle esbuild 0.18.20 under Drizzle-loaderen med samme rettede minorserie, som Drizzle-kit allerede bruger direkte. Fordi loaderens deklarerede range er ældre, kræves den udførte kompatibilitetstest; ændringen er ikke en påstand om upstreams officielle support af overriden.

`tests/tooling-compatibility.test.mjs` kører både synkron og asynkron TypeScript-transform gennem den faktiske loader og genererer/validerer repositoryets Drizzle-schema i en disponibel mappe. De eksisterende migrationsprøver kontrollerer genkørsel, rollback, constraints og checksums. Den gamle esbuild-undtagelse er fjernet fra auditpolitikken. [Advisoryen](https://github.com/advisories/GHSA-67mh-4wv8-2f99) angiver 0.25.0 som første rettede version.

Efter ændringen: `npm audit --omit=dev` har 0 fund; fuld audit har 8 high og 0 moderate/critical. De resterende fund er alle direkte eller transitive følger af [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), i alt 9 præcise dependency-noder. Registryets nyeste braces er 3.0.3, og advisoryen angiver ingen rettet version. En generel override eller skjult omklassificering løser derfor ikke den resterende risiko.

Braces bruges i build/lint-globmatchning, ikke i produktionsafhængighederne. De eksisterende isolerede CI-jobs har tidsgrænser og ingen produktionscredentials. Undtagelsen er fortsat afgrænset til advisory, package-version og node; udløb 4. november 2026 er uændret. Nye/ændrede fund eller udløb stopper gaten. Hvis der ikke kommer en understøttet patch inden fristen, kræves særskilt valg mellem dokumenteret værktøjsudskiftning og en reviewet vedligeholdt fork. K03 er dermed delvist lukket i kode; braces-gælden står åbent med konkret upstreamblokering.

## Workers udviklingsrendering

En ren installation reproducerede en HTTP 500 i lokal Workers-rendering: runtime eksponerede `console.createTask`, men kaldet kastede en ikke-implementeret-fejl. Reacts udviklingsbuild brugte metoden efter en eksistenskontrol. Fejlen er rapporteret i [vinext #3234](https://github.com/cloudflare/vinext/issues/3234), med et åbent upstream-rettelsesforslag [#3233](https://github.com/cloudflare/vinext/pull/3233), verificeret 5. oktober 2026.

`build/workerd-dev-console.mjs` er en midlertidig, udviklingsafgrænset Vite-adapter for vinexts server-globals i RSC og SSR. Den afprøver den valgfrie debugfunktion og behandler kun en ubrugelig funktion som fraværende. Den ændrer ikke almindelige logs, fungerende tracing, browserkoden eller produktionsbuild. Både negative enhedstest og det faktiske lokale Worker-forløb skal bestå. Fjern adapteren, når en låst upstream-udgave løser problemet, og gentest efter en ren installation.
