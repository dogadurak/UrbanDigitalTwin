# Figures

Generated from the result files, never transcribed:

```bash
docker exec -e PYTHONPATH=/app -w /app geotwin-ai-service \
  python -m app.experiments.make_figures --out results/figures
cp ai-service/results/figures/*.png docs/img/
```

| File | Shows |
|---|---|
| `fig-horizon.png` | forecast accuracy against horizon, against the ASHRAE G14 criterion |
| `fig-ladder.png` | what each model addition is worth, and how much a random split flatters it |
| `fig-cities.png` | per-city transfer under leave-one-city-out |

Re-run after any experiment and the images follow the numbers.

## Dashboard screenshots

Not included. Automated capture was built and removed: headless Chromium in the
frontend container has no GPU, so CesiumJS never initialises WebGL and the map
half of every frame came out black. Software rendering (SwiftShader) fails on
Alpine too. A script that silently produces broken images is worse than none.

To add them, take four from a real browser at ~1680x1000 with the stack running:

| Suggested file | View |
|---|---|
| `01-overview.png` | `http://localhost:5173/#results` |
| `02-screening.png` | `http://localhost:5173/#screening` |
| `03-buildings.png` | `http://localhost:5173/#buildings` |
| `04-cities.png` | `http://localhost:5173/#cities` |
