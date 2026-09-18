# Spotter v0

Closest-to-the-pin on a driving range. First field site: **Indian Tree Golf Club, Arvada**.

One phone. Two players. Hitter swings. Spotter taps the landing on the satellite map. Not a launch monitor.

## Local path

`C:\Users\tonys\Projects\spotter`

Grok writes to the cloud artifacts folder. Copy or unzip into that path, then File → Open Folder in VS Code.

## Run on the Windows coding laptop

```bat
cd C:\Users\tonys\Projects\spotter
start.bat
```

Or:

```bat
npm start
```

Then on the phone, same Wi-Fi: `http://LAPTOP-IP:8765`

Find the laptop IP: `ipconfig` → Wireless LAN → IPv4.

Add to Home Screen in Safari/Chrome for full-screen.

Do not open `index.html` as a file. GPS and the service worker need `http://`.

## First bucket

1. Leave **Use Indian Tree range preset** on.
2. Pin: **150 yd**.
3. Five shots each.
4. Stay in the bay. Do not walk the landing area.

Mon–Wed grass · Thu–Sun mats · range 7:00a–6:30p · last ball 7:00p.

## v0 includes

- Indian Tree tee + 100 / 150 / 175 / 200 yd pins
- Manual calibrate (tap tee, tap pin, or Use my GPS)
- Closest-to-the-pin scoring
- Undo, move pin, missed ball, end early
- Last names remembered on this device

## Not in v0

Rings / corridor games, two-phone sync, accounts, course marketplace, lessons, ball tracking.

## Repo

Tony owns git. Suggested remote: `https://github.com/TRSCode` as `spotter`.
