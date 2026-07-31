# Campus Exchange

**The Ultimate Marketplace & Community Platform for College Students**

This repo hosts the official promotional website for the Campus Exchange Android app, along with the Digital Asset Links configuration that lets shared item links open directly inside the app.

🔗 **Live site:** https://maheshapurvastudio.github.io/campus-exchange/

## About the app

Campus Exchange lets students buy, sell, and trade textbooks, notes, electronics, hostel gear, and study materials securely within their own college community.

- 📚 **Campus Marketplace** — listings organized by department (CO, AIML, ME, CE, EE, EJ/ET) and academic year (FE, SE, TE, BE)
- 💬 **Instant Student Chat** — real-time messaging with custom notification sounds for quick on-campus meetups
- 👤 **Verified Student Profiles** — custom @handles, department badges, batch years, and roll number verification
- 🔍 **Smart Search & Filters** — filter by category, price range, department, or keyword
- 🔗 **Deep Link Integration** — item links open straight into the app via Digital Asset Links

## Repo structure

```
campus-exchange/
├── .nojekyll               # Disables Jekyll processing so .well-known/ is served as-is
├── index.html               # Promotional landing page (single file, HTML/CSS/JS)
└── .well-known/
    └── assetlinks.json      # Digital Asset Links — verifies app ↔ site ownership
```

## Digital Asset Links

`assetlinks.json` authorizes the Campus Exchange Android app to open links under this domain directly, instead of a browser. It must remain reachable at:

```
https://<domain>/.well-known/assetlinks.json
```

## Deployment

This site is deployed with **GitHub Pages**, served straight from the repo root on the `main` branch.

## Author

Built by [Mahesh Apurva](https://maheshapurvastudio.github.io/)
