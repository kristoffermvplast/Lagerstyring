# Fase 26 – Samlet integrationstest og driftsklarhed

## Omfang og accept

Fra main `ec84bd573bc045415370027ee1826bcd0470f716`. Oprindeligt acceptkriterium: **Funktions-, belastnings-, adgangs- og gendannelsestest bestået**. Ingen nye forretningsfunktioner, migrationer eller UI/UX-redesign. Tidligere dokumenterede resultater og NOT_RUN-afgrænsninger bevares.

## Ny verifikation

`tests/operations.test.ts` bruger eksisterende NestJS HTTP-ruter og DatabaseService, begrænset backendrolle, alle eksisterende migrationer i en tom lokal database og syntetiske virksomheder. Auth-provider er en lokal stub, der kun accepterer registrerede tokens; dette er ikke en ny rigtig Supabase-loginprøve.

| Risiko | Ny konkret kontrol |
| --- | --- |
| Brud mellem moduler | Kunde/leverandør/materialeimport → startbeholdning → modtagelse → flytning → forsendelse/reservation → rapport/CSV → prognose |
| Dubletbogføring og decimaler | Genforsøg på modtagelse/forsendelse, 100.00000001 + 9.99999999 − 8 = 102; prognose før og efter afsendelse er 102; journal = saldi |
| Adgang på tværs af moduler | Andre virksomheders tokens og virksomhedsstier afvises; læser kan ikke importere; ugyldig/tilbagekaldt session afvises; anden virksomhed virker fortsat |
| Storage/adgang | Foto læses som enabled=false; browserroller har ikke app-schemaadgang; backend har ikke app_private-adgang. Tidligere Storage-tests bevares; hosted foto aktiveres ikke |
| Begrænset belastning | 120 HTTP-læsninger, 10 samtidige arbejdere, pool højst 4; blandede virksomheder, 0 uventede statuskoder, ingen datamutation; p95 < 5 sekunder og samlet < 45 sekunder |
| Gendannelse | pg_dump custom archive og pg_dumpall roller uden passwords → separat tom PostgreSQL-instans; alle app/app_private/auth-fixturetabeller hashes, ACL/RLS/ejerforhold sammenlignes, rapport/isolation/idempotent importgenforsøg efter restore |

Belastningsgrænserne er et reproducerbart lokalt acceptbudget, ikke et kapacitetsløfte for Railway/Supabase. Komplekse produktions-/retur-/spildforløb genbruges fra allerede beståede modul- og samtidighedstests. En lokal Auth-stub beviser ikke Supabase-tjenestens drift eller skalerbarhed.

## Kørsel og sikkerhedsgrænse

- `npm run build -w @lager/api` og `npx vitest run tests/operations.test.ts`: lokal PGlite-integration/adgang; de to native PostgreSQL-prøver markeres som skipped.
- `bash scripts/verify-operations-local.sh`: to midlertidige lokale PostgreSQL 17-containere, 127.0.0.1:55433/55434. Scriptet afviser eksisterende containernavne, opretter kun egne testdatabaser og fjerner egne containere/volumener ved afslutning.
- Ingen hosted URL accepteres af native test. Tom kilde kræves; intet reset. Syntetisk backup holdes i proceshukommelse og publiceres ikke som artifact.
- Standard CI udvides med denne native test. Det giver konkret grund til CI-regression, men allerede beståede tests gentages ikke manuelt lokalt.

## Verifikationsstatus

- Lokal backend-build PASS.
- Lokal integration/adgang/sessionkontrol: 3 tests PASS; native belastning/gendannelse: 2 NOT_RUN lokalt (Docker/PostgreSQL-runtime ikke tilgængelig i Work-miljøet).
- Native PostgreSQL og CI: afventer arbejdsgrenens kørsel. Ingen PASS påstås endnu.
- Hosted backup og gendannelse: NOT_RUN. Der er ikke hentet produktionsdata eller gennemført restore i Supabase.
- Fase 26 er derfor endnu ikke fuldt afsluttet eller godkendt til pilot. Se [drifts- og gendannelsesplan](operations.md).

## Økonomi og releasegrænse

Lokal implementering/test: 0 kr. Repository er offentligt, eksisterende runner er standard ubuntu-latest. Ny native kontrol bruger kun kortlivede Docker-processer på samme runner; ingen nye caches, artifacts, tjenester eller betalte runners. Arbejdsgren/CI: forventet 0 kr., realistisk worst-case 0 kr. jf. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Railway-forbindelsen bekræfter source main; arbejdsgren udløser ikke den normale main-deployment. Ingen PR-/previewmiljøer oprettes.

Main-publicering og eventuell automatisk Railway-deployment kræver særskilt vurdering efter 1 kr.-reglen (tidligere estimat 0–0,30 kr., worst-case 1–3 kr. for build/opstart/containeroverlap). Ingen main-publicering eller hosted ændringer er udført i denne fase.

Foto forbliver deaktiveret hosted. UI/UX-forenklingskravene bevares: færre obligatoriske felter, kun nødvendige felter synlige som standard, valgfrie/skjulte avancerede felter hvor forsvarligt, enklere oprettelse og mere intuitiv navigation. Efter Fase 26 skal slutstatus gennemgås, før denne særskilte runde må startes.
