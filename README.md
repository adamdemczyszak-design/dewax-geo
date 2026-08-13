# dewax geo — Asystent Wiertacza GSHP

Narzędzie dowodowe dla branży wiertniczej: generuje raport geologiczny pod otwór dolnego
źródła pompy ciepła (GSHP) **wyłącznie** na podstawie oficjalnych danych Państwowego
Instytutu Geologicznego – PIB (CBDG).

> **Zasada naczelna:** lepiej pokazać brak danych niż ładny, niepodparty profil.
> Aplikacja nigdy nie interpoluje, nie ekstrapoluje i nie zgaduje. Brak danych jest
> wypisany wprost: *„brak danych w sprawdzonym zakresie"*.

---

## 1. Wykorzystane usługi PGI-PIB / CBDG

Wszystkie adresy zostały zweryfikowane odpytaniem usługi przed napisaniem kodu.
Rejestr endpointów znajduje się w [`server/endpoints.ts`](server/endpoints.ts) i jest
jedynym miejscem, w którym wolno dodać źródło danych geologicznych.

### 1.1 Otwory wiertnicze

| | |
|---|---|
| **Nazwa wg wykazu CBDG** | Otwory wiertnicze CBDG |
| **Adres** | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/cbdg_otwory/MapServer/0` |
| **Protokół** | ArcGIS REST — operacja `/query` (usługa udostępnia też `WMSServer` i `WFSServer`) |
| **Układ natywny** | EPSG:2180 (PL-1992), jednostki: metry |
| **Limit transferu** | 1000 rekordów na zapytanie (`maxRecordCount`) |
| **Rola** | Wyszukiwanie przestrzenne otworów w promieniu od punktu inwestycji |

Pobierane atrybuty: `ID_CBDG`, `NAZWA`, `GLEBOKOSC`, `RZEDNA`, `STRAT`, `CEL_WIERC`,
`ROK`, `MIEJSCOWOSC`, `GMINA`, `POWIAT`, `WOJEWODZTWO`, `PODS_LOKA`.

> **Uwaga techniczna.** Pola `SZ_GEO` / `DL_GEO` w tej warstwie są zapisane w formacie
> spakowanym DMS (np. `521355` = 52°13′55″), **nie** w stopniach dziesiętnych. Aplikacja
> ich nie używa — pozycję bierze z geometrii obiektu żądanej w `outSR=4326`.

### 1.2 Profile litologiczne — rdzeń dowodowy raportu

| | |
|---|---|
| **Nazwa** | CBDG Otwory wiertnicze — API aplikacji |
| **Adres bazowy** | `https://otworywiertnicze.pgi.gov.pl` |
| **Protokół** | REST / JSON |

Wykorzystywane zasoby:

```
GET /boreholes/{id}                                    metryka otworu + wykaz dostępnych zestawów danych
GET /boreholes/{id}/lithologicalprofiles               lista profili litologicznych
GET /boreholes/{id}/profiles/{profileId}/lithologicalunits   warstwy: from, to, description, chronostratigraphy
GET /boreholes/{id}/stratigraphicprofiles              lista profili stratygraficznych   (opcjonalnie)
GET /profiles/{profileId}/stratigraphicLayers/C        warstwy chronostratygraficzne     (opcjonalnie)
```

To jedyne w CBDG źródło **opisu litologicznego warstwa po warstwie** (`od–do` + opis
słowny). Bez niego nie da się ani zbudować profilu, ani wykryć ryzyk wiertniczych.
Odpowiedź `/boreholes/{id}` zawiera obiekt `features`, który mówi wprost, czy dla danego
otworu istnieje profil litologiczny — dzięki temu nie odpytujemy zasobów na ślepo.

Zapytania o stratygrafię są **domyślnie wyłączone** (`includeStratigraphy: false`):
chronostratygrafia każdej warstwy przychodzi już razem z profilem litologicznym, a dwa
dodatkowe zapytania na otwór podwajałyby czas analizy.

### 1.3 Hydrogeologia

| Nazwa | Adres | Rola |
|---|---|---|
| Monitoring wód podziemnych (PSH) | `…/hydrogeologia/mwp/MapServer/0` | **jedyne** źródło z pomierzonym zwierciadłem: `ZWIERCIADLO_NAW`, `ZWIERCIADLO_SWOBODNE`, strop/spąg warstwy wodonośnej, litologia, wydajność |
| Obiekty hydrogeologiczne CBDH | `…/hydrogeologia/cbdh_otwory/MapServer/0` | otwory hydrogeologiczne w otoczeniu |
| GZWP / LZWP | `…/hydrogeologia/gzwp/MapServer` (warstwy 0, 1, 2) | czy punkt leży w granicach zbiornika (ograniczenia formalne) |
| JCWPd | `…/hydrogeologia/jcwpd/MapServer` (warstwa 2 = podział na 174) | przypisanie do jednolitej części wód podziemnych |

Zapytania o GZWP i JCWPd to `point-in-polygon` w EPSG:2180.

### 1.4 Parametry projektowe dolnego źródła — MPGN

| | |
|---|---|
| **Nazwa** | Mapa Potencjału Geotermii Niskotemperaturowej (MPGN) |
| **Adres** | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geotermia/mpgn/MapServer` |
| **Zapytanie** | `point-in-polygon` w EPSG:2180 |

Jedyne oficjalne źródło liczb, z których projektuje się dolne źródło. Serwis publikuje
wartości w przedziałach głębokości 40 / 70 / 100 / 130 m — aplikacja dobiera przedział
najbliższy zadanej głębokości otworu.

| Parametr | Warstwy (40/70/100/130 m) | Pola |
|---|---|---|
| λ — przewodność termiczna [W/(m·K)] | 25 / 26 / 27 / 28 | `OD_FROM`, `DO_TO`, `ZAKRES_RANGE` |
| q<sub>v</sub> — wydajność termiczna [W/m], 1800 h/rok | 15 / 16 / 17 / 18 | `ZAKRES` |
| q<sub>v</sub> — wydajność termiczna [W/m], 2100 h/rok | 20 / 21 / 22 / 23 | `ZAKRES` |

MPGN podaje **przedziały**, nie pojedyncze liczby, dlatego wynik doboru też jest
przedziałem. Uśrednianie sugerowałoby precyzję, której dane nie mają.

Wstępny dobór długości odwiertów:

```
Q  = P × (1 − 1/SCOP)      moc pobierana z gruntu
L  = Q / q_v               łączna długość odwiertów
n  = ceil(L / H)           liczba odwiertów o głębokości H
```

To **nie jest** projekt dolnego źródła: nie uwzględnia bilansu rocznego, regeneracji
gruntu, wpływu sąsiednich odwiertów ani c.w.u. ponad przyjęty czas pracy. Dla instalacji
większych podstawą doboru powinien być test reakcji termicznej (TRT).

### 1.5 Rzędna terenu — GUGiK NMT

| | |
|---|---|
| **Adres** | `https://services.gugik.gov.pl/nmt/?request=GetHByXY&x=<X>&y=<Y>` |
| **Układ** | PL-1992, konwencja geodezyjna: **X = northing, Y = easting** (odwrotnie niż kolejność x,y w ArcGIS) |
| **Odpowiedź** | zwykły tekst, np. `116.8` |

Nie jest źródłem danych geologicznych — dostarcza wyłącznie wysokość punktu, bez której
nie da się poprawnie skorelować profili (patrz 2.3).

### 1.6 Punkty badawcze

`…/analizy_pkt_bad/MapServer/0` — „Punkty badawcze i dokumentacyjne CBDG". Wykorzystywane
do kontroli pokrycia obszaru dodatkowymi analizami.

### 1.7 Geokodowanie — moduł całkowicie odseparowany

| | |
|---|---|
| **Dostawca** | GUGiK — Usługa Uniwersalnej Wyszukiwarki (UUG) |
| **Adres** | `https://services.gugik.gov.pl/uug/?request=GetAddress&location=…&srid=4326` |

Geokoder zamienia adres na współrzędne **i nic więcej**. Nie dostarcza żadnych informacji
o gruncie i żadne jego dane nie trafiają do części geologicznej raportu.

Zachowanie usługi ustalone empirycznie:

- `location=Miasto, Ulica` → typ `street`, zwraca geometrię ulicy → **niepewność ~300 m**
- `location=Miasto` → typ `city`, zwraca punkty miejscowości → **niepewność ~2000 m**
- zapytanie z numerem domu jest odrzucane przez filtr dokładności usługi
  (`found objects: 15, returned objects: 0`)
- kod pocztowy nie jest przyjmowany jako zapytanie (`Blad zapytania.`) — służy wyłącznie
  do zawężania wyników

Dlatego adapter próbuje kolejno *ulica → miejscowość* i **jawnie raportuje poziom
dopasowania oraz wynikającą z niego niepewność pozycji**. Wiertacz musi wiedzieć, czy
punkt to działka, czy środek ulicy.

Adapter zapasowy (Nominatim/OSM) jest **domyślnie wyłączony**; włącza go zmienna
`GEOCODER_FALLBACK=nominatim`. Służy wyłącznie do lokalizacji adresu — nigdy do danych
geologicznych.

### 1.8 Źródła świadomie **niewykorzystane**

Google, fora, Wikipedia, mapy regionalne, „wiedza ogólna o budowie geologicznej regionu"
— **żadne z nich nie jest źródłem danych w tej aplikacji**. Jeżeli CBDG nie ma danych,
raport pokazuje ich brak.

---

## 2. Architektura

```
Przeglądarka (React + TS)
        │  /api/geocode   /api/analyze   /api/endpoints
        ▼
Funkcje serwerowe Netlify (Node + TS)        ← tu odpytywane są usługi PGI (brak CORS)
        │
        ├── geocoder/        adapter GUGiK UUG (+ opcjonalny Nominatim)
        ├── gis/             rzędna terenu z NMT GUGiK
        ├── cbdgClient       transport: URL, cache TTL+LRU, ponowienia, audyt
        ├── mpgnClient       λ i q_v z Mapy Potencjału Geotermii Niskotemperaturowej
        ├── sizing           wstępny dobór długości odwiertów
        ├── locationQuality  klasa niepewności położenia otworu z pola PODS_LOKA
        ├── credibility      ocena wiarygodności całego raportu (0–100)
        ├── boreholeSearch   wyszukiwanie przestrzenne + pobieranie profili
        ├── oodaLoop         sterowanie promieniem wyszukiwania
        ├── profileBuilder   syntetyczny profil + wykrywanie luk
        ├── riskDetector     ryzyka ze słów kluczowych w litologii
        └── reportBuilder    złożenie raportu i podsumowania dowodowego
```

### 2.1 Pętla OODA

```
Obserwuj   → odpytaj CBDG w bieżącym promieniu
Zorientuj  → zbuduj profil, policz pokrycie 0–H, znajdź luki
Zdecyduj   → pokrycie 100% → koniec; inaczej → rozszerz promień
Działaj    → następny promień z drabiny: 200 → 500 → 1000 → 2000 → 5000 m
```

Po wyczerpaniu drabiny pozostałe luki są oznaczane jako brak danych. Każdy cykl trafia do
dziennika audytu z promieniem, liczbą otworów, pokryciem i uzasadnieniem decyzji.

### 2.2 Budowa syntetycznego profilu

Dla każdego przedziału głębokości wybierany jest **najbliższy otwór, który faktycznie ma
opis litologiczny na tej głębokości**. Sąsiadujące przedziały o tym samym opisie i tym
samym otworze są scalane. Przedział bez żadnych danych → `noData: true`.

Każda warstwa z danymi niesie komplet dowodów: `ID CBDG`, nazwa otworu, odległość [m],
zakres `od–do` [m] oraz adres usługi źródłowej.

### 2.3 Korekta wysokościowa — obowiązkowa, nie kosmetyczna

Otwory CBDG stoją na różnych rzędnych. Sklejanie warstw po samej głębokości „m p.p.t."
daje profil przesunięty pionowo o różnicę wysokości między otworem a działką — w mieście
łatwo o 5–10 m błędu. Geolog koreluje warstwy po **rzędnej bezwzględnej**.

```
przesunięcie = rzędna_działki − rzędna_otworu
głębokość_na_działce = głębokość_w_otworze + przesunięcie
```

Rzędna działki pochodzi z NMT GUGiK (1.5), rzędna otworu z pola `RZEDNA` w CBDG. Jeśli
którakolwiek jest nieznana, korekta **nie jest** stosowana, a raport mówi o tym wprost
i obniża ocenę wiarygodności. Każda warstwa niesie oryginalny zakres w otworze
(`sourceFromM`/`sourceToM`) oraz wielkość korekty (`elevationShiftM`).

Skutek uboczny jest pożądany: otwór stojący 10 m niżej niż działka nie dokumentuje
górnych 10 m profilu — i pojawia się tam jawna luka, zamiast fałszywego pokrycia.

### 2.4 Jakość położenia otworu

Pole `PODS_LOKA` z CBDG jest tłumaczone na klasę niepewności:

| Klasa | Podstawa lokalizacji | Niepewność | Waga dowodowa |
|---|---|---|---|
| geodezyjna | pomiar GPS / geodezyjny | ~10 m | 1,00 |
| mapowa | mapa, szkic lokalizacyjny | ~100 m | 0,75 |
| nieznana | brak informacji / „nie ustalono" | ~500 m | 0,40 |
| przybliżona | współrzędne najbliższej miejscowości | ~1000 m | 0,20 |

Bez tego odległość „195 m od punktu" policzona z pozycji przypisanej wg najbliższej
miejscowości byłaby fałszywą precyzją. Klasa jest pokazywana w tabeli otworów, na mapie
(przerywany okrąg niepewności) i wchodzi do oceny wiarygodności.

### 2.5 Ocena wiarygodności raportu

Samo „pokrycie 100%" jest komunikatem mylącym: profil zszyty z jednego otworu z 1958 r.
oddalonego o 500 m, o lokalizacji wg najbliższej miejscowości, ma pokrycie 100% i zerową
wartość projektową. Dlatego nagłówek raportu podaje ocenę 0–100 złożoną z:

| Składowa | Maks. | Co mierzy |
|---|---|---|
| pokrycie profilu | 35 | ile zakresu 0–H ma dane |
| liczba otworów | 20 | 1 otwór = 4 pkt, 4+ = 20 pkt (potwierdzenie krzyżowe) |
| bliskość dowodów | 25 | odległość najdalszego użytego otworu |
| jakość lokalizacji | 12 | średnia waga klas położenia użytych otworów |
| korekta wysokościowa | 8 | czy udało się sprowadzić profile do rzędnej działki |

Progi: ≥78 wysoka, ≥55 umiarkowana, ≥32 niska, poniżej — orientacyjna. Do oceny dołączona
jest lista konkretnych powodów jej obniżenia.

### 2.6 Kolejność pobierania profili (budżet)

Profile pobierane są przez osobne zapytania HTTP, więc obowiązuje budżet:
**48 otworów łącznie, 14 na cykl, 5 równolegle, 9 s na całość**.

Kolejność: 3 najbliższe otwory → otwory o głębokości ≥ docelowej wg odległości →
pozostałe wg odległości.

Powód drugiego kroku: w centrach miast zdecydowana większość otworów CBDG to płytkie
wiercenia geologiczno-inżynierskie (10–35 m). Bez tego priorytetu budżet zjadały otwory,
które fizycznie nie mogą domknąć profilu do 100 m. **To jest wyłącznie kolejność
pobierania** — o doborze warstw do raportu i tak decyduje odległość.

Limit na cykl istnieje, bo bez niego pierwszy, najciaśniejszy promień zużywał cały budżet
globalny i analiza kończyła się z 0% pokrycia.

### 2.7 Odległości

`haversineDistanceM` (R = 6 371 008,8 m). Zapytania przestrzenne wysyłane są w EPSG:2180
(proj4), a odległość każdego otworu jest **przeliczana lokalnie i twardo filtrowana** —
wynik nie zależy od sposobu buforowania po stronie serwera.

### 2.8 Cache i audyt

- **Cache** — TTL 6 h + LRU (500 wpisów), kluczowany pełnym URL, wspólny dla instancji funkcji.
- **Audyt** — każde zapytanie: znacznik czasu, etap, promień, endpoint, status HTTP, czas
  odpowiedzi, `cache: hit|miss`, liczba wyników, decyzja. Dziennik jest częścią raportu
  i eksportu JSON.

### 2.9 Wykrywanie ryzyk

Dziewięć kategorii istotnych dla wiercenia GSHP: kurzawka, piaski nawodnione, wody
artezyjskie/napięte, iły poznańskie i pstre, kras, anhydryty/gipsy, skały zwięzłe, głazy
i otoczaki, grunty organiczne.

Detekcja: normalizacja tekstu (usunięcie polskich znaków, małe litery) → dopasowanie słów
kluczowych w opisach CBDG, z listą negacji (`brak wody`, `suchy`). Dodatkowo z pomiarów
PSH: zwierciadło ustalone < 0 m p.p.t. → samowypływ; różnica nawiercone − ustalone > 1 m
→ zwierciadło napięte.

Raport podaje też kategorie **sprawdzone i niepotwierdzone** — brak dowodu to nie to samo
co brak zagrożenia.

---

## 3. Uruchomienie

```bash
npm install
npm run dev        # http://localhost:5173 (emulacja funkcji przez @netlify/vite-plugin)
npm test           # 123 testy jednostkowe
npm run typecheck
npm run build
```

Zmienne środowiskowe (opcjonalne):

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `GEOCODER_FALLBACK` | *(brak)* | `nominatim` włącza pomocniczy geokoder OSM |
| `NOMINATIM_URL` | publiczna instancja OSM | adres instancji Nominatim |

---

## 4. Testy

| Plik | Zakres |
|---|---|
| `tests/distance.test.ts` | haversine, azymut, transformacja PL-1992 ↔ WGS84, zgodność odległości |
| `tests/oodaLoop.test.ts` | rozszerzanie promienia, warunki stopu, zapis decyzji w audycie |
| `tests/profileBuilder.test.ts` | wykrywanie luk (strop, środek, spąg, wielokrotne), scalanie, preferencja bliższego otworu, komplet dowodów |
| `tests/riskDetector.test.ts` | wszystkie 9 kategorii, negacje, deduplikacja, ryzyka z pomiarów PSH |
| `tests/reportBuilder.test.ts` | kolejność pobierania profili, opis warunków hydrogeologicznych, polska odmiana liczebników, parsowanie dat ArcGIS |
| `tests/elevationCorrection.test.ts` | przeliczenie profilu na rzędną działki w obie strony, luki wynikające z korekty, otwory bez rzędnej, komplet dowodów |
| `tests/geothermal.test.ts` | parsowanie przedziałów MPGN, dobór przedziału głębokości, wzór doboru długości odwiertów, klasy jakości lokalizacji, punktacja wiarygodności |
| `tests/cbdgClient.test.ts` | cache TTL/LRU, poprawność budowanego URL, mapowanie atrybutów, filtr promienia, obsługa błędów usługi |

---

## 5. Ograniczenia — czytać przed użyciem

1. **Pokrycie profilami litologicznymi jest nierówne.** W centrach dużych miast bywa, że na
   1000 otworów w promieniu 1 km tylko kilka ma profil litologiczny w CBDG.
2. **Limit 1000 rekordów** usługi ArcGIS — przy jego osiągnięciu raport mówi o tym wprost.
3. **Geokodowanie adresu nie schodzi do numeru domu** (ograniczenie usługi GUGiK). Dla
   dokładnego wyniku należy użyć GPS na działce.
4. **Czytaj ocenę wiarygodności, nie samo pokrycie.** Pokrycie 100% zbudowane z jednego
   otworu oddalonego o 500 m to nie to samo co pokrycie 100% z ośmiu otworów w promieniu
   150 m — i ocena z sekcji 2 to rozróżnia.
5. **Dobór długości odwiertów jest wstępny.** Opiera się na q<sub>v</sub> z map
   regionalnych MPGN, nie na pomiarze w konkretnym punkcie. Nie uwzględnia bilansu
   rocznego ani wpływu sąsiednich odwiertów.
6. **Aplikacja nie sprawdza wymagań formalnych** — Prawo geologiczne i górnicze, strefy
   ochronne ujęć, zapisy MPZP. Przynależność do GZWP jest raportowana jako fakt, bez
   interpretacji prawnej.
7. **Podkład mapowy nie jest źródłem danych geologicznych** — służy wyłącznie orientacji
   przestrzennej i weryfikacji, czy punkt trafił we właściwą działkę.
8. Raport **nie zastępuje** projektu robót geologicznych, dokumentacji hydrogeologicznej
   ani testu reakcji termicznej (TRT).

---

## 6. Źródła danych

- **Dane geologiczne i hydrogeologiczne:** Centralna Baza Danych Geologicznych,
  Państwowy Instytut Geologiczny — Państwowy Instytut Badawczy (PIG-PIB).
- **Geokodowanie adresów:** Główny Urząd Geodezji i Kartografii (GUGiK), rejestry PRG/EMUiA.
