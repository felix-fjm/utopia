# UTOPIA – Immersive 3D Megacity Flythrough

Echtzeit-Freiflug durch eine prozedural generierte, praktisch endlose Science-Fiction-Megacity –
optimiert für Safari auf dem iPhone 16 Pro. TypeScript · Three.js (WebGL 2) · Vite.

> **Asset-Status:** Die lizenzierten **KitBash3D-Utopia**-Modelle sind *nicht* enthalten (kostenpflichtig, dürfen
> nicht weitergegeben werden). Ohne sie zeigt die App **temporäre Platzhalter-Gebäude**, sichtbar markiert mit
> „Temporäre Platzhalter · nicht Utopia“. Sobald die Pipeline unten einmal mit dem Kit gelaufen ist, ersetzt die App
> die Platzhalter automatisch durch die Original-Assets.

## Schnellstart

```bash
npm install
npm run dev          # Entwicklungsserver, im LAN erreichbar (http://<Mac-IP>:5173)
npm run build        # Produktions-Build -> dist/
npm run preview      # Produktions-Build ausliefern (http://<Mac-IP>:4173)
npm run build:single # eine einzige, selbst-enthaltene HTML-Datei -> dist-single/index.html (nur Platzhalter)
npm run test:e2e     # automatisierte Tests (Preview-Server muss auf :4173 laufen)
```

Benötigt Node.js ≥ 20. Für Tests: Google Chrome/Chromium (`CHROME=/pfad/zu/chrome`).

### Auf dem iPhone öffnen (gleiches WLAN)

1. Am Rechner `npm run build && npm run preview` (oder `npm run dev`) starten. Vite zeigt unter **Network** eine Adresse wie `http://192.168.178.23:4173/`.
2. iPhone im selben WLAN → Safari → diese Adresse öffnen.
3. Empfohlen: Querformat. Für echten Vollbildmodus ohne Safari-Leisten: Teilen → **Zum Home-Bildschirm**, dann von dort starten.
4. macOS-Firewall fragt ggf. nach eingehenden Verbindungen für `node` → erlauben.

URL-Parameter: `?quality=performance|balanced|high|ultra`, `?preset=golden|day|blue|night`, `?seed=123`, `?dev` (Overlay), `?placeholders` (Assets ignorieren), `?fixedres` (adaptive Auflösung aus).

## Challenge-Version: 30 Tore

`npm run dev:challenge` (oder `?mode=challenge` an jede URL) · Single-File: `npm run build:challenge` → `dist-challenge/index.html`.

- 30 nummerierte Tore pro Seed, quer durch die Stadt (~22–24 km). Typen: **über der Skyline**, **zwischen Türmen**, **Straßenschlucht** (auf Boulevards, knapp über dem Boden) und **Park-Tiefflug**. Jede Torposition wird gegen die echte generierte Geometrie geprüft (Gebäude, Bäume, Hochstraßen, Pfeiler, Monorail, Skybridges, Landmarken).
- Nur das richtige nächste Tor zählt; ein falsches Tor meldet „Falsche Reihenfolge“.
- Hinweise: goldene Lichtsäule (aktuelles Tor), blaue Säule (Tor danach), pulsierende Leuchtspur, Hologramm-Schilder mit Pfeil, Distanz und Steigen/Sinken, Kompass-Marker am Bildrand mit Distanz und Höhendifferenz.
- Timer, Zwischenzeiten, Checkpoints bei 10/20, Sound, Bestzeit pro Strecke (lokal im Browser). ↺/R = zurück zum letzten Tor (+5 s Strafe). Wer Ghost-Modus nutzt, bekommt keine Bestzeit-Wertung.
- Test: `node tests/challenge.mjs` – prüft Routengültigkeit und fliegt zwei Strecken komplett mit Kollision durch.

## Verwandlungs-Version: Auto & Frosch

`npm run dev:morph` (oder `?mode=morph`) · Single-File: `npm run build:morph` → `dist-morph/index.html`.

- Auf den Straßen stehen Autos (auf den Fahrspuren, nie in Gebäuden), in Parks, auf Gehwegen und an Plätzen hüpfen große Sci-Fi-Frösche herum. Alles wird wie die Stadt seed-basiert um den Spieler gestreamt.
- **Flieg in ein Auto** → du fährst es: Joystick oben/unten = Gas/Bremse/Rückwärts, links/rechts = Lenken, ⚡ = Nitro, Slider = Höchstgeschwindigkeit (km/h). Gebäude sind solide, die Verfolgerkamera lässt sich mit dem rechten Daumen drehen und richtet sich beim Fahren wieder hinter dem Auto aus.
- **Flieg auf einen Frosch** → du bist der Frosch: Joystick = hüpfen in Blickrichtung, ▲ (bzw. Space) = großer Sprung, Slider = **Sprungstärke** (Anzeige in Metern Sprunghöhe). Frösche landen auf Hausdächern und springen von dort weiter.
- Als Auto oder Frosch erscheinen **leuchtende, halbtransparente Kugeln** am Boden (mit Lichtsäule und Kompass-Marker). Hinein fahren oder springen → zurück im Flugmodus; Auto bzw. Frosch bleibt dort zurück und kann wieder übernommen werden.
- Test: `node tests/morph.mjs` (18 Prüfungen: Platzierung, Einsteigen, Fahren, Lenken, Bremsen, Gebäudekollision, Kugel-Rückkehr, Sprungstärke, Hüpfen, Dachlandung, Streaming-Grenzen).

## Vier Verwandlungs-Versionen: Neo City, Frankfurt, Sydney, Hongkong

| Version | Starten (lokal, im WLAN aufs iPhone) | Build (statisch hostbar) |
|---|---|---|
| Neo City (KitBash3D) | `npm run dev:neocity` | `npm run build:neocity` |
| Google Frankfurt | `npm run dev:frankfurt` | `npm run build:frankfurt` |
| Google Sydney | `npm run dev:sydney` | `npm run build:sydney` |
| Google Hongkong | `npm run dev:hongkong` | `npm run build:hongkong` |

Alternativ jede URL mit `?city=frankfurt|sydney|hongkong`. In der App lässt sich die Stadt im ⚙-Menü wechseln.

### Google-Städte (fotorealistische 3D-Kacheln)
- **Zugang:** beim ersten Start fragt die App nach einem **Cesium-ion-Token** (kostenlos: ion.cesium.com → Access Tokens) **oder** einem **Google-Maps-API-Schlüssel** (Map Tiles API). Gespeichert wird nur im Browser. Alternativ `.env.example` → `.env.local` kopieren und dort eintragen.
- **EU-Hinweis:** Google liefert die Photorealistic 3D Tiles seit 8. Juli 2025 für Projekte mit EWR-Rechnungsadresse nicht mehr aus (HTTP 403). Der Cesium-ion-Weg ist dafür gedacht; ob er für dein Konto funktioniert, zeigt der erste Start. Bei einem Fehler fragt die App erneut nach dem Zugang.
- **Echte Größen:** Auto 4,9 × 2,0 × 1,2 m, Frosch ca. 14 cm (Kamera rückt nah heran, Sprungkraft 0,1–19 m). Die Welt ist metrisch (Zentrum der Stadt = Ursprung, +Y = oben).
- **Straßen & Parks** kommen live aus OpenStreetMap (Overpass API, Umkreis 3 km um das Zentrum): Autos stehen auf echten Fahrspuren (Sydney und Hongkong: Linksverkehr), Frösche in echten Parks und an Gehwegen, Kugeln mitten auf ruhigen Straßen und in Parks. Bodenhöhe, Dächer und Wände werden per BVH-Raycast direkt auf dem Google-Mesh bestimmt (Frösche springen auf echte Dächer, Autos fahren echte Rampen und prallen an Fassaden ab).
- **Hosting:** Diese Versionen laden Daten von Google/Cesium/OpenStreetMap und laufen deshalb nicht als Claude-Seite. Lokal mit `npm run dev:…` oder den `dist-…`-Ordner auf eigenem Webspace (z. B. GitHub Pages, Netlify). Den Token dann per URL-Beschränkung auf deine Domain begrenzen.
- **Quellenangaben** (Google-Datenquellen, © OpenStreetMap-Mitwirkende) werden unten links eingeblendet – bitte nicht entfernen.
- **Test ohne Internetzugang:** `npm run test:real` erzeugt eine synthetische, in Frankfurt verortete 3D-Tiles-Stadt im selben Format samt OSM-Daten und prüft Einnordung, Platzierung, Größen, Kollision, Dachlandung und Moduswechsel.

### Neo City
1. Gratis-Kit auf kitbash3d.com laden (Konto → Kit in den Warenkorb → Checkout; **nicht** über Cargo, die Cargo-Gratisassets sind nur privat lizenziert).
2. Export + Optimierung wie oben unter „Utopia-Assets einbinden“, nur mit Kit-Namen:
   `blender --background --factory-startup --python tools/blender/export_utopia.py -- --src <Neo-City-Datei> --out assets-private/export --kit "KitBash3D Neo City"` und danach `npm run assets:optimize`.
3. `npm run dev:neocity`. Empfohlen: Atmosphäre „Nacht“ oder „Blaue Stunde“.

## Steuerung

| | iPhone | Desktop |
|---|---|---|
| Fliegen waagerecht (vor/zurück/seitlich in Blickrichtung, Höhe bleibt gleich) | linker Daumen: virtueller Joystick (springt zum Daumen, federt zurück) | W A S D / Pfeile |
| Blickrichtung (Yaw/Pitch) | rechter Daumen: ziehen | Maus ziehen |
| Steigen / Sinken (einzige Höhenänderung, kombinierbar mit Joystick) | ▲ / ▼ rechts | Space/E · Q/C |
| Boost (×5) | ⚡ gedrückt halten | Shift |
| Geschwindigkeit 5–1000 m/s (log.) | Slider unten | Mausrad |
| Autopilot (Kinoflug) · Pause · Immersiv · Einstellungen | Tasten oben rechts | O · P · I |
| Kollision / Ghost-Modus, Reset, Neue Stadt, Atmosphäre, Qualität, Empfindlichkeit, Dev-Overlay | ⚙ | G · R · 1–4 · F |

Beide Daumen arbeiten gleichzeitig (Pointer-ID-Tracking). Seiten-Scrollen, Zoom, Textauswahl und iOS-Gesten werden auf der Flugfläche unterdrückt; Safe Areas (Dynamic Island, Home-Indikator) sind berücksichtigt.

## Utopia-Assets einbinden

1. **Kit beschaffen** (nur durch dich – ich habe nichts gekauft): <https://kitbash3d.com/products/utopia> → nach dem Kauf unter *My Kits* oder über die **Cargo**-App herunterladen. Laut Produktseite: 31 Modelle, 7 PBR-Materialien, Formate FBX/OpenUSD/MaterialX bzw. Blender-Version. Für den Export am besten die **Blender**- oder **FBX**-Variante laden.
2. Dateien nach `assets-private/` legen (git-ignoriert).
3. Export mit Blender 4.x (headless):
   ```bash
   blender --background --factory-startup --python tools/blender/export_utopia.py -- \
     --src "assets-private/KB3D_Utopia/<Kit-Datei>.blend|.fbx|.usd" --out assets-private/export
   ```
   Erkennt jedes Modell (Top-Level-Hierarchie), fasst es zu einem Objekt zusammen, setzt die Basis-Mitte auf den Ursprung, rechnet Zentimeter → Meter um (auto) und erzeugt LOD0 (Original), LOD1 (30 %), LOD2 (8 %) per Decimate. Je LOD **eine** GLB, damit die gemeinsamen Materialien/Texturen nur einmal im Speicher liegen.
4. Optimieren + Manifest:
   ```bash
   npm run assets:optimize            # WebP-Texturen (2048/1024/512 je LOD), Meshopt-Kompression
   npm run assets:optimize -- --ktx2  # zusätzlich KTX2/Basis (GPU-komprimiert), benötigt KTX-Software `ktx`
   ```
   Kategorien (supertower/tower/mid/low/landmark) werden aus Höhe/Grundfläche/Namen abgeleitet; Korrekturen in `assets-private/export/categories.json` (`{"modell-id": "landmark"}`).
5. `npm run dev` – die App lädt `public/assets/utopia/manifest.json`, zuerst LOD2 (schneller Start), dann LOD1/LOD0 im Hintergrund. Original-Proportionen bleiben erhalten (Skalierung nur 0,85–1,18, gleichmäßig).

Ohne Kit lässt sich die komplette Kette mit einem synthetischen Test-Kit prüfen: `npm run assets:testkit && npm run assets:optimize` (App zeigt dann „Test-Kit · nicht Utopia“; danach `public/assets/utopia/` wieder löschen).

**Lizenz:** KitBash3D verbietet das Weitergeben eigenständiger Assets. `assets-private/` und `public/assets/utopia/` sind git-ignoriert. Ein lokaler LAN-Server für dich ist unkritisch; **bevor** du eine Version mit Utopia-Assets öffentlich hostest, prüfe deine Lizenzstufe/EULA (Web-Auslieferung macht GLBs grundsätzlich extrahierbar) bzw. frag beim KitBash3D-Support nach.

## Architektur

- `src/world/layout.ts` – Stadtmorphologie als reine Funktionen von (Seed, Position): Voronoi-Distrikte (Zentrum, Business, Wohnen, Civic, Gärten) mit eigener Rasterdrehung, Blockgröße und Boulevards, Kernfelder für Skyline-Gipfel, Distrikt-Grenzalleen, Parks, Landmark-Plätze. In GLSL gespiegelt (`ground.ts`), damit Straßen/Plätze am Boden exakt zu den Gebäuden passen.
- `src/world/cityGen.ts` – deterministische 500-m-Chunks: Gebäude auf globalem Kandidatengitter mit prioritätsbasierter Konfliktauflösung (nahtlos über Chunkgrenzen), Landmarken, Bäume, Hochstraßen mit Pfeilern, Monorail-Ebene, Skybridges, Kollisionszylinder.
- `src/world/cityRenderer.ts` – Streaming (zeitbudgetiert, Richtung der Fahrt bevorzugt, Entladen außerhalb Radius), Chunk-Frustum-Culling, Distanz-LOD, GPU-Instancing mit festem Satz Draw Calls (je Archetyp×LOD×Material), Floating Origin.
- `src/world/environment.ts` – Himmel in Cubemap → Hintergrund + PMREM-IBL, animierte Wolkenkuppel, Sterne, gerichteter/höhenabhängiger Dunst (Atmosphärenperspektive), Schatten um die Kamera, 4 Presets.
- `src/controls/` – Flugphysik (exponentielle Beschleunigung, Look-Glättung, kein Roll, Substeps gegen Durchtunneln), Autopilot mit Hindernis-Vorausschau, Multitouch-/Tastatur-Eingabe.
- Adaptive Auflösung (Frame-Zeit-EMA), Qualitätsstufen, Dev-Overlay (FPS, Frame-Zeit, Draw Calls, Dreiecke, Chunks, Instanzen, GPU-Ressourcen, Heap).

WebGPU: bewusst nicht aktiviert. WebGL 2 ist auf iOS-Safari die verlässliche Basis; der Renderer ist durch Instancing CPU-seitig bereits schlank, ein WebGPU-Pfad würde TSL-Materialien erfordern und auf iOS mehr Risiko als Nutzen bringen.

## Teststatus

`tests/e2e.mjs` (Headless Chrome, SwiftShader-Software-GL): Start ohne Fehler, Rendering, echte 3D-Meshes, Vorwärtsflug = Blickrichtung, Steigen unabhängig vom Pitch, Kollision, Chunk-Laden/-Entladen, Speicher über 60 km Flug, iPhone-Emulation mit simultanem Zwei-Finger-Multitouch, Joystick-Rückstellung, Lenken im Flug, kein Roll, kein Seiten-Scroll/Zoom, Touch-Tasten, LAN-Erreichbarkeit.
**Nicht gemessen:** Bildrate auf einem echten iPhone. Die FPS-Werte der Tests stammen aus Software-Rendering und sagen nichts über Geräteleistung aus.
