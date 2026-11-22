# Glimmgrund

[▶ Glimmgrund im Browser spielen](https://emfau88.github.io/glimmgrund/)

Ein kleines Echtzeit-Aufbauspiel für Handy und Desktop. Unter der Mooswiege warten Pilzbeete, Erzadern und neugierige Höhlenkäfer. Du gibst deiner Mannschaft Aufträge und entscheidest, wohin das Dorf wächst.

## Die ersten zwei Minuten

1. Markiere zwei Felsen. Die **Goldader** im Kupferstollen bringt zwölf zusätzliche Goldstücke. Die **Leuchtsporen** am Moosstollen führen ein Feld weiter zur Sporenkammer. Mit ihr kostet jeder Pilzköder drei Nahrung weniger. Du kannst direkt auf die Schilder tippen.
2. Pip übernimmt deine Grabaufträge der Reihe nach. Ein erneuter Tipp nimmt eine Markierung zurück. Luma bringt währenddessen alle drei Sekunden einen Pilz zum Sammelkorb. Achte auf das **+1** am Beet. Über **Nahrung** kannst du zusätzlich selbst pflücken.
3. Baue einen Pilzgarten auf einem freien Feld oder wirb einen zweiten Gräber an. Auf der Karte steht dein aktuelles Ziel. Antippen öffnet die Details im Höhlenbuch.
4. Öffne nach drei Grabungen **Käferpfade** und tippe auf **Käfer jetzt anlocken**. Die erste Gruppe nimmt den zuerst erschlossenen der beiden Zugänge. Sind beide noch verschlossen, kommt sie über den natürlichen Durchlass im Moosstollen. Tippe auf **Brumm rufen**. Brumm geht zum Treffpunkt und führt die Käfer auf der Karte hinaus.

## Die große Käferwanderung

Der erste angekündigte Besuch findet an Tag 4 statt. Danach wechseln sich die Zugänge ab. Im Menü **Käferpfade** siehst du die nächste Ankunft und kannst an jedem Zugang einen Pilzköder vorbereiten. Eine Wachstube in höchstens zwei Feldern Entfernung bringt dort drei Wachstärke, eine weiter entfernte einen Punkt. Beim Platzieren zeigt jeder Bauplatz seinen Bonus für den nächsten Besuch.

Ziel der Wanderung sind zwei sichere Heimwege und drei friedlich abgeschlossene Besuche. Nach zwei friedlichen Besuchen kommt die große Gruppe mit fünf Käfern. Du kannst die Termine abwarten oder die Gruppen selbst rufen, sobald dein Dorf bereit ist. Die Käfer warten am Treffpunkt auf deine Entscheidung.

## Bedienung

Mit einem Finger verschiebst du die Karte, mit zwei Fingern kannst du zoomen und drehen. Auf dem Desktop funktionieren auch Ziehen mit der Maus und das Mausrad. Die Tasten **1–4** wählen die Werkzeuge, **Q/E** drehen die Karte und die **Leertaste** pausiert.

Ein Spieltag dauert 90 Sekunden aktive Spielzeit. Pause und ein Wechsel in den Hintergrund halten die Zeit an. Der Browser speichert auch angefangene Grabaufträge, ausgelegte Köder und laufende Käferbegleitungen. Frühere Spielstände am gleichen Spielort werden übernommen.

## Lokal spielen

Lade `index.html` herunter und öffne die Datei in einem aktuellen Browser. Spiel, Grafiken und Schriften stecken in dieser einen Datei. Die 3D-Karte nutzt WebGL oder den eingebauten Software-Renderer. Für die lokale Version brauchst du weder einen Server noch eine Installation.

## Entwickeln und testen

Die Simulation und die Käferwege liegen in `src/simulation/`, die 3D-Modelle und Renderer in `src/render/`. `src/ui/` enthält Bedienelemente und das Besuchsmenü. `src/game.js` verbindet Eingaben, Uhr, Spielstand und Anzeige. Bilder und Schriften liegen unter `assets/`.

Mit Node.js 22 lassen sich Quellen und Assets wieder zur eigenständigen `index.html` bündeln.

```sh
npm ci
npm run build
npx playwright-core install --only-shell chromium
npm test
```

GitHub Actions baut die Datei neu, vergleicht sie mit dem Commit und prüft Grabfolge, Ernte, Spielstände und beide Käferwege. Zwei Browserläufe bedienen das Spiel im Handyformat mit Touch. Nach erfolgreichen Tests veröffentlicht der Workflow die Einzeldatei auf GitHub Pages.
