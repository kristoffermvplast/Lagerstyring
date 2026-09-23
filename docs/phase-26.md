# Fase 26 – Samlet integrationstest og driftsklarhed

Aktuel status: **AFSLUTTET 2026-09-23 inden for brugeraccepteret omfang**. Endelig pilotafklaring nedenfor erstatter tidligere åbne pilot-/afslutningsstatusser; historisk evidens og testbegrænsninger bevares.

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

## Verifikationsstatus ved implementering (historisk)

- Lokal backend-build PASS.
- Lokal integration/adgang/sessionkontrol: 3 tests PASS; native belastning/gendannelse: 2 NOT_RUN lokalt (Docker/PostgreSQL-runtime ikke tilgængelig i Work-miljøet).
- Native PostgreSQL og CI: PASS på `261fc75`; se endeligt resultat nedenfor.
- Hosted backup og gendannelse: NOT_RUN. Der er ikke hentet produktionsdata eller gennemført restore i Supabase.
- Fase 26 er derfor endnu ikke fuldt afsluttet eller godkendt til pilot. Se [drifts- og gendannelsesplan](operations.md).

## Økonomi og releasegrænse ved implementering (historisk)

Lokal implementering/test: 0 kr. Repository er offentligt, eksisterende runner er standard ubuntu-latest. Ny native kontrol bruger kun kortlivede Docker-processer på samme runner; ingen nye caches, artifacts, tjenester eller betalte runners. Arbejdsgren/CI: forventet 0 kr., realistisk worst-case 0 kr. jf. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Railway-forbindelsen bekræfter source main; arbejdsgren udløser ikke den normale main-deployment. Ingen PR-/previewmiljøer oprettes.

Main-publicering og eventuell automatisk Railway-deployment kræver særskilt vurdering efter 1 kr.-reglen (tidligere estimat 0–0,30 kr., worst-case 1–3 kr. for build/opstart/containeroverlap). Ingen main-publicering eller hosted ændringer er udført i denne fase.

Foto forbliver deaktiveret hosted. UI/UX-forenklingskravene bevares: færre obligatoriske felter, kun nødvendige felter synlige som standard, valgfrie/skjulte avancerede felter hvor forsvarligt, enklere oprettelse og mere intuitiv navigation. Efter Fase 26 skal slutstatus gennemgås, før denne særskilte runde må startes.

## Første native CI og målrettet recovery-rettelse

CI `35759662258` på `64f9be9`: 305 almindelige tests, 21 samtidighedstests og fire af fem native driftsprøver består. Belastning: 120 kald / 10 arbejdere / pool 4, p95 42 ms, samlet 379 ms. Recovery standsede ved PostgreSQLs kontrol af den oprindelige grantor: målcluster var initialiseret med en anden bootstrap-administrator. Browser/runtime-trinene blev derfor ikke kørt i dette forsøg.

Rettelse: begge disponible instanser initialiseres med samme bootstraprolle `postgres`. Kun den ene forventede `CREATE ROLE postgres;` udelades fra rolledumpen, fordi rollen allerede eksisterer; alle ALTER/grants bevares, og alle andre fejl stopper restore. Tomt mål og identiske rolletilhørsforhold inklusive grantor/ADMIN/INHERIT/SET kontrolleres eksplicit. Ingen hosted roller eller applikationsrettigheder ændres.

## Endeligt CI-resultat – 2026-09-22

[CI 35760194974](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35760194974): **SUCCESS** på `261fc7531a9018cd47ddbc765ae93cd25fb52012`, arbejdsgren `phase26-operations`. Remote tree `406abcaf80bc685e5a052dea9c789410c29ffc1c` er verificeret identisk med lokal `c593026`.

- 305 almindelige unit/API/databasetests PASS; 23 skipped er de 21 særskilte samtidighedsprøver og de to native driftsprøver, der udføres i efterfølgende trin.
- 21 PostgreSQL-samtidighedstests PASS.
- Alle 5 native driftsprøver PASS. Tre er integration/adgang/session fra den almindelige kørsel, gentaget bevidst på native PostgreSQL; to er nye belastnings-/restoreprøver. Tallene summeres ikke som unikke testcases.
- Belastning: 120 HTTP-kald, 10 samtidige arbejdere, pool højst 4; p95 **30 ms**, samlet **271 ms**, 0 uventede statuskoder og uændrede forretningsdata. Dette er en lille syntetisk lokal prøve, ikke hosted kapacitet.
- Gendannelse: **50 tabeller**, **466.842 bytes** archive, **776 ms** til dump/rolleoverførsel/restore/efterkontrol. Archive SHA-256 `020d8f30593d042f6b2060a4031ca43aeb7165c85811752433c2e78d6ef15fad`. Datahash, ejere/ACL/RLS og rolletilhørsforhold er identiske; rapport, isolation og idempotent importgenforsøg består efter gendannelse. Ingen produktionsdata er eksporteret.
- 240 browserprøver PASS samt workspace-typechecks/builds, backend runtime-image, diagnostikscript og strict TLS/CA-runtimekontrol.

Implementering og automatiseret verifikation er færdige. **Fuld driftsafslutning/pilotgodkendelse er ikke påstået**: faktisk hosted backup/gendannelse og den tilhørende operatørprocedure er `NOT_RUN`; frontendens pilotadgang skal fortsat afklares. Der er ingen nye API-ruter eller ændret applikationsadfærd, som kræver en ny forretningsverifier. Tidligere online-evidens bevares med dens NOT_RUN-grænser.

Main er læst tilbage og uændret på `ec84bd573bc045415370027ee1826bcd0470f716`. Ingen main-push, Railway-deployment, hosted migration eller ressourceændring er udført. Main-publicering af den konkrete test-/driftsleverance afventer særskilt økonomisk accept, fordi normal automatisk Railway-deployment ikke sikkert kan holdes under 1 kr.: forventet 0–0,30 kr., realistisk worst-case 1–3 kr., baseret på build/opstart/kort containeroverlap på eksisterende ressourcer. Tidligere økonomiske godkendelser gjaldt konkrete tidligere pushes.

Denne afsluttende CI-dokumentation gemmes lokalt for ikke at udløse endnu en CI-kørsel. Foto forbliver deaktiveret hosted. Ingen UI/UX-redesign eller anden ny fase startes; næste samlede trin aftales efter gennemgang af slutstatus og de åbne driftspunkter.

## Main, automatisk deployment og målrettet online-verifikation – 2026-09-22

Brugeren godkendte publicering af præcis `261fc75` og normal automatisk Railway-deployment på eksisterende ressourcer (forventet 0–0,30 kr., realistisk worst-case 1–3 kr.). Main er fast-forwardet uden force og læst tilbage som `261fc7531a9018cd47ddbc765ae93cd25fb52012`. Lokal dokumentationscommit `b1d3246` er ikke medtaget.

Railway-forbindelsen bekræfter deployment `f2168b7a-8c5a-4628-80a7-da3bf789bec9`, branch main, commit `261fc7531a9018cd47ddbc765ae93cd25fb52012`, **SUCCESS** 2026-09-22T17:30:57.679Z. Ingen manuel deployment eller ændring af ressourcer/konfiguration.

- `/api/health/live`: 200.
- `/api/health/ready`: 200.
- `/api/companies/:companyId/access` uden token: 401.
- `/api/companies/:companyId/forecast/options` uden token: 401.

`PHASE_26_DEPLOYMENT_SMOKE_VERIFICATION: PASS`. Dette er den nødvendige afgrænsede deploymentkontrol for en leverance uden ændringer i apps/, migrationer eller dependencies. Tidligere autentificeret online-verifikation genbruges med dens dokumenterede omfang; ingen ny login-/forretnings-PASS påstås. Ingen gamle lokale/CI-tests er genkørt manuelt; main-push kan starte normal eksisterende CI automatisk.

[Driftsplanen](operations.md) afklarer nu konkret hosted backup → lokal gendannelse (forventet/worst-case 0/0 kr. i eksterne tjenesteudgifter under de beskrevne forudsætninger), de nødvendige lokale værktøjer/credentials/opbevaring og den billigste frontendpilot: eksisterende lokal HTTPS på samme Wi-Fi (0/0 kr.). Ekstern frontendadgang kræver særskilt valg/godkendelse; en ny statisk service og mulig CORS-deployment er ikke oprettet.

**Fase 26 er endnu ikke fuldt driftsafsluttet:** faktisk hosted eksport/lokal restore er NOT_RUN, og pilotens netværks-/adgangsomfang er endnu ikke bekræftet. Afklaring er ikke det samme som udført gendannelse. Foto forbliver deaktiveret hosted. Ingen migrationer, ressourceændringer, UI/UX-redesign eller nye faser. Denne resultatdokumentation gemmes lokalt, uden et ekstra main-push/deployment.

## Faktisk hosted backup → lokal databasegendannelse – afsluttet 2026-09-23

Brugeren godkendte eksport fra eksisterende Supabase Free-projekt, sikker krypteret lokal opbevaring og restore til isoleret miljø på egen Mac. Forventet og accepteret realistisk worst-case: 0 kr. i eksterne tjenesteudgifter. Ingen produktionsændringer/reset, nye hosted miljøer, Railway-ændringer eller frontendhosting. Evidensen nedenfor er operatørens tilbagemeldte terminalresultater fra 2026-09-22–23; Work-agenten har ikke hentet rå backup eller hemmeligheder.

- Mac: FileVault On, 62 GiB ledigt før opsætning. Gratis Homebrew, Colima 0.10.3, Docker CLI 29.8.1 og Supabase CLI 2.117.0 installeret. Colima-profil `lager-backup-test`, 2 CPU/4 GiB RAM/20 GiB disk; Docker-server 29.5.2. Kun lokale ressourcer.
- Netværk `lager-backup-local` med host_binding_ipv4=127.0.0.1. Containerporte verificeret på loopback. Lokal database PostgreSQL 17.6, samme version som kilden. Før restore: ingen app/app_private-tabeller og ingen lokale Auth-brugere.
- Kildetilslutning: eksisterende session pooler, administratorpassword kun via skjult `psql`/dump-prompt; intet password i kommandolinje, Git eller chat. TLS `verify-full` og eksisterende Supabase CA. Container-DNS fejlede; Mac-resolverens IP blev midlertidigt angivet med PGHOSTADDR, mens hostname-verificering blev bevaret. Gamle passwordforsøg blev afvist; korrekt password virkede uden reset.
- PGOPTIONS gav ikke den ønskede read-only-status gennem pooleren (`off`). De udførte forespørgsler var SELECT; eksplicit `BEGIN READ ONLY` blev derefter verificeret som `on`. Ingen global produktionsindstilling ændret.
- Eksport: én fuld `pg_dump --format=custom` (konsistent databasesnapshot) samt separat `pg_dumpall --roles-only --no-role-passwords`; begge PASS. Rollen- og databasesnapshot er separate, ikke en påstået atomisk clusterbackup. Supabase CLI blev brugt til lokalt miljø, ikke til den endelige eksport.
- Filer kopieret fra lokal container til `~/lager-backup-fase26/backup` under en privat mappe (0700) på FileVault-krypteret disk; eksport oprettet med umask 077. Ca. 861 kB rapporteret ved kopiering, ikke præcis dumpstørrelse. Identiske SHA-256 i container og Mac:
  - `database.dump`: `23bf43d5a7e2ce405614ba3c9e7e2ce025e2d194aab22d94780313af9535a900`
  - `roles.sql`: `6d9a009be31a6734cfd50a8807290a720f4e2163e9893bf8c013e1254e7110c7`
- Projektrollerne app_backend/app_owner/app_runtime med de eksporterede ALTER-indstillinger og GRANT app_* blev gendannet lokalt i én transaktion uden fejl. Alle øvrige rollenavne fandtes i Supabase-basismiljøet; managed systemrollers egenskaber/medlemskaber blev ikke overskrevet eller påstået identiske med hosted.
- Ny tom lokal database `phase26_restored`, TEMPLATE template0, i den isolerede lokale container. Fuld `pg_restore --single-transaction --exit-on-error` uden udeladelser, no-owner eller no-acl gav `LOCAL_DATABASE_RESTORE: PASS`. Der blev ikke kørt projektmigrationer.
- Kildens og målets tabelantal matcher: app 47, app_private 1, auth 27, realtime 3, storage 8, supabase_migrations 1, vault 1; i alt **88**. `realtime.messages` er en partitioneret hovedtabel uden egen datablok; derfor **87** COPY-datablokke, ikke en manglende tabel.
- Backupens data blev udlæst lokalt via pg_restore --data-only og sammenlignet med pg_dump --data-only af det gendannede mål. Sammenligning bevarede tabel-/kolonneidentitet, alle COPY-rækker inklusive dubletter og sekvens-setval; kun rækkefølge blev normaliseret. Begge gav **87 tabeller, 405 rækker, 2 sekvenser** og `RESTORED_DATA_MATCH: PASS`.
- Colima-profilen blev stoppet med bekræftet `done`. Backupfiler og den lokale gendannelse bevares; ingen offentlige tjenester eller nye deployments.

Resultat: `HOSTED_BACKUP_EXPORT: PASS`, `HOSTED_BACKUP_LOCAL_RESTORE: PASS` og `RESTORED_DATA_MATCH: PASS`, inden for den autoriserede databaseprøve. Ingen fejl i selve eksport/restore/datasammenligning. Forbindelsesproblemerne ovenfor blev løst før eksport.

### Afgrænsninger og stoppunkt

Dette erstatter tidligere NOT_RUN for faktisk hosted eksport → lokal databasegendannelse. Det er **ikke** en komplet Supabase-platformgendannelse eller hosted-til-hosted katastrofeprøve. Nye Auth-login, virksomhed A/B gennem applikationen, bogføringsgenforsøg og særskilt runtime-RLS/ACL-verifikation på denne faktiske kopi er NOT_RUN; den tidligere syntetiske CI-evidens genbruges kun med sit eget omfang. Restore indeholdt databaseejerskab/grants/policies uden restorefejl, men dette er ikke en selvstændig sammenligning af alle managed roller eller en applikationsadgangstest.

Storage-objektfiler, deploymentkonfiguration, passwords og eksterne krypteringsnøgler indgår ikke som verificeret gendannelse. Vault-rækker matcher som lagret data; dekryptering med hosted nøgler er ikke testet. FileVault er diskkryptering; dumpen er ikke selvstændigt passwordkrypteret til videreforsendelse og må ikke deles eller flyttes til ukrypteret opbevaring. Ingen separat off-device kopi eller fast backupplan er etableret. Eksakt eksport-/restorevarighed, RPO/RTO og billing/restkvote er ikke målt/verificeret i denne Mac-prøve; ingen faktisk fakturakontrol påstås.

Den godkendte backup-/gendannelsesprøve afsluttes her. Fuld pilot/driftsgodkendelse afventer særskilt slutstatus, backupansvar/frekvens/retention og valg af frontendadgang. Ingen frontendhosting, Railway-ændringer, nye faser eller UI/UX-redesign startes. Foto forbliver deaktiveret hosted. Kun lokal dokumentation opdateres; intet push/deployment.

## Endelig frontendpilotafklaring og faseafslutning – 2026-09-23

Brugeren godkendte backup-/gendannelsesresultatet i `8665ed0` med de dokumenterede begrænsninger og bad om kun at afklare, om eksisterende lokal HTTPS og fysisk mobil-/QR-test opfylder frontendadgangskravet, og i så fald afslutte Fase 26.

**Vurdering: ja, for en afgrænset lokal pilot på samme betroede Wi-Fi.** Fasekravet angiver funktion, belastning, adgang og gendannelse; intet dokumenteret krav gør offentlig hosting eller adgang uden for netværket til en forudsætning. Den tidligere afprøvede lokale frontend giver faktisk browseradgang fra telefonen. Dermed vælges den allerede fungerende lokale løsning som Fase 26-pilotadgang; en ny tjeneste er ikke nødvendig.

Pilotopsætningen er eksisterende Mac med React/Vite-frontend over mkcert HTTPS og lokal backend. Mac og begge processer skal være tændt; enheder skal være på samme netværk og have tillid til det lokale certifikat. Brug den gældende lokale IP med tilsvarende certifikat; tidligere `192.168.1.73:5173` er historisk, ikke et løfte om en fast adresse. Ingen offentlig Vite-eksponering eller port-forwarding. Privat CA-nøgle deles ikke.

Evidens genbruges målrettet fra [Fase 23](phase-23.md#final-operator-acceptance--2026-09-21): login/virksomhedsvalg, de dokumenterede sidevisninger, iPhone-formularer/menu og kameraets start/stop. Tidligere fysisk QR-opslag fra Fase 16 er genbrugt i Fase 23. Dette dokumenterer adgangsmetodens egnethed, ikke en ny fysisk regressionstest af Fase 26/main eller nye importer/forecastflows. Lokale menu-/feltrettelser er ikke dermed påstået publiceret. Tablet forbliver NOT_RUN. Ingen gammel test genkøres.

`PHASE_26_FRONTEND_PILOT_ACCESS: ACCEPTED (existing local HTTPS; same Wi-Fi; prior operator evidence reused)`

`PHASE_26_STATUS: CLOSED (user-authorized scope and documented limitations)`

CI og deployment/online-smoke genbruges fra `261fc75`; faktisk hosted backup → lokal restore genbruges fra `8665ed0`. Login/applikationsadgang efter faktisk restore er ikke testet, Storage-filer er ikke omfattet, og separat off-device backup er ikke etableret. Øvrige dokumenterede begrænsninger, herunder Vault-dekryptering, RPO/RTO og fast backupplan, bevares som driftsopfølgning; de omklassificeres ikke til PASS. Afslutning er ikke en ubegrænset produktions-/katastrofegendannelsescertificering.

Denne handling ændrer kun dokumentation lokalt: forventet merudgift **0 kr.**, realistisk worst-case **0 kr. i eksterne tjenesteudgifter**, fordi ingen eksterne tjenester, hosting, tests eller deployments startes. Ingen main-push. Senere ekstern frontendadgang, ændringer eller publicering vurderes særskilt efter økonomireglen. Foto forbliver deaktiveret hosted. Arbejdet stopper; særskilt slutstatus og eventuel UI/UX-forenkling startes kun på brugerens instruktion.
