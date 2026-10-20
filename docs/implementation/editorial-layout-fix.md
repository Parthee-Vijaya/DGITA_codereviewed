# Responsivt forside- og vejledningslayout · 20. oktober 2026

Rettelsen bygger på den deployede samlingsbranch `preview/vercel-2026-10-17` (`935d9e2`). Main og forretningslogikken ændres ikke.

## Årsag

På den faktiske Vercel-side havde vejledningens tekstkolonne ved 2560 px skærmbredde 620 px indvendig afstand på begge sider. Kolonnen var kun 1331 px bred, så overskrift og brødtekst havde cirka 91 px at stå på. Den ydre sidemargen blev fejlagtigt også brugt mellem foto og tekst.

Forsidens hjælpebillede blev vist med sin naturlige 4:3-proportion. Ved samme skærmbredde var billedet cirka 520 px højt, mens rammen var 627 px høj. De nederste cirka 107 px viste derfor rammens grå baggrund. Samme manglende billedfyldning gjaldt de to øvrige store editorial-billeder.

## Rettelse

- Venstre indvendige afstand i vejledningens tekstkolonne begrænses til 48–104 px. Den ydre højremargen og de eksisterende mobilindstillinger bevares.
- De tre store fotos fylder deres eksisterende rammer med `object-fit: cover`; billedfiler, alt-tekster og CMS-funktionalitet bevares.
- Vejledningens enkeltkolonne på tablet bruger `minmax(0, 1fr)`, så indholdets minimumsbredde ikke gør kolonnen bredere end skærmen.

Kun `app/globals.css` ændrer applikationen. Ingen database-, auth-, API-, KLE- eller Vercel-miljøændringer er nødvendige.

## Kontrol og levering

Rettelsen skal kontrolleres på den byggede Vercel Preview før det stabile alias flyttes: forside, vejledning, indlæste billeder, overskrift/brødtekst, fravær af vandret overløb samt CMS-billedknapper. Kontrollen omfatter mobil, tablet og store skærme, inklusive 2560 og 3840 px. Browsermålinger og skærmbilleder opbevares uden adgangskoder eller sessionsdata; resultater og konkret deployment registreres i PR’en.

Deployment bygges på Vercels Linux-platform, som krævet af databasepakkens native modul. Det eksisterende beskyttede Preview-projekt og testadgang bevares. Ved behov kan det stabile alias føres tilbage til den foregående fungerende deployment; ingen datamigration indgår.
