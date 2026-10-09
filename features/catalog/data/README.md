# D-GITA systemkatalog

`system-catalog.json` er den komplette, deploybare runtimekilde til systemopslaget. Cloudflare-buildet har derfor ingen afhængighed til lokale Excel-filer.

Kataloget er normaliseret fra:

- `IT Systemkatalog Overblik.xlsx`: 4.656 unikke KITOS-systemer
- `IT Systemer Overblik.xlsx`: 420 Kalundborg-systemer koblet til KITOS via UUID

Hver post indeholder de felter, løsningen bruger til søgning og visning: KITOS-id, officielt navn, leverandør, rettighedshaver, kilde, kommunal anvendelse, matchmetode, lokale aliaser/system-id'er og status i KITOS/Kalundborg. Alle 420 kommunale match er markeret med `source: "both"` og `matchConfidence: "exact-id"`.

Rå regnearkskolonner, som ikke anvendes af løsningen, og administrative placeholderværdier er bevidst ikke kopieret til webkataloget. De oprindelige `.xlsx`-filer versionsstyres ikke, så unødvendige interne oplysninger ikke publiceres sammen med webappen.

Erstatnings- og tilkøbsrelationer gemmer nu katalogets stabile id og navn samt en teknisk revision af den valgte post. Ved ny indsendelse kontrolleres relationen mod denne lokale runtimekilde; en ændret eller manglende post kræver et nyt valg. Fritekst fra ældre kladder bevares, indtil anmoder vælger en post eller eksplicit registrerer systemet manuelt med en begrundelse. Allerede indsendte snapshots og kvitteringer omskrives ikke.

Der fulgte ingen dokumenteret eksport-/opdateringsdato med katalogkilden. `features/catalog/metadata.ts` angiver derfor `sourceUpdatedAt: null`, og brugerfladen viser, at opdateringsdatoen ikke er oplyst. Den tekniske revision er hverken en dato, dokumentation for aktualitet eller en sikkerhedsgodkendelse. Opdatér datoen først sammen med dokumenterede kildedata.

Sagsdetaljer projicerer manglende relationsfelter fra ældre versioner som `null` og bevarer de oprindelige tekstlabels. Gyldige katalogreferencer og manuelle begrundelser udleveres som objekter gennem samme feltvalidator som kladder; ugyldige objekter bliver `null`, så ekstra interne felter ikke udleveres. Projektionen sker kun i læseresultatet og ændrer hverken lagrede snapshotbytes, hash eller kvitteringer. Rettelser af det manuelle systemnavn ændrer ikke de allerede valgte relationer.
