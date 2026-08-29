# Dashboard screenshots

Four images, referenced from the repository README.

| File | Tab | URL |
|---|---|---|
| `01-overview.png` | Results — ladder table and measured intensity by use | `http://localhost:5173/#results` |
| `02-screening.png` | Screening — ranked shortlist | `http://localhost:5173/#screening` |
| `03-buildings.png` | Buildings — diagnosis, deviation scan, load curves | `http://localhost:5173/#buildings` |
| `04-cities.png` | Cities — per-city transfer accuracy | `http://localhost:5173/#cities` |

Take them from a normal browser at roughly 1680x1000, with the stack running and
the dataset built.

Automated capture was attempted and removed: headless Chromium in the frontend
container has no GPU, so the CesiumJS globe never initialises WebGL and the map
half of every frame comes out black. A real browser is required for these.
