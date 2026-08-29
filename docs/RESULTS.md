# Does urban context help predict building energy? A measured answer on BDG2

**Short version.** No — and not because the measurement failed. On the Building
Data Genome 2 dataset we measured the *theoretical ceiling* of any site-level
spatial variable and found it small: **2.8 CV(RMSE) points**. Real building
attributes, on the same folds, are worth **21.5 points**. Location, encoded
perfectly, is worth about an eighth of what floor area and building use are
worth.

Reproduce with:

```bash
python -m app.data_engineering.build_dataset
python -m app.experiments.run_ladder --task cold_start --rows-per-building 800 --seeds 3
python -m app.experiments.analyse_ladder --run results/ladder/cold_start
```

---

## 1. Why the usual version of this question cannot be asked here

BDG2 does not publish building locations. From Miller et al. (2020),
*Scientific Data* 7:368:

> "Latitude and longitude data were set to the central location of either the
> site or the city in which the site is located."
> "In all cases, all buildings are within a 25-mile (40-kilometer) radius of the
> central location of the site or city."
> "lat: Latitude of building location **to city level**."

A 40 km radius is 5,027 km², about 3.2 times Greater London. A 250 m buffer —
the scale at which NDVI, LST or built-up density is normally sampled — is
**1/25,600** of that area. A value extracted at the published coordinate
describes an arbitrary point in a metropolitan region, not a building.

So no Sentinel-2, Landsat LST, LCZ or GHSL layer is computed anywhere in this
repository. That is a design constraint of the dataset, not a budget problem,
and no amount of processing removes it.

Two further consequences of taking the 40 km bound seriously:

**Fold structure.** Sites closer together than the positional uncertainty are
not distinguishable places. Measured across BDG2:

| Site pair | Distance |
|---|---:|
| Crow ↔ Moose | 3.77 km |
| Mouse ↔ Robin | 1.06 km |
| Mouse ↔ Shrew | 2.48 km |
| Robin ↔ Shrew | 2.22 km |

Ottawa is two "sites"; London is three. Merging transitively takes 15
coordinate-bearing sites to **12 independent blocks**. Holding out one London
site while training on the other two would not test transfer to an unseen city.
Corroborated independently by the weather data: Crow and Moose resolve to
identical NOAA-ISD series.

**One coordinate is simply wrong.** `Wolf` is recorded at latitude 53.3498,
longitude **+6.2603**, timezone `Europe/Dublin`. Dublin is at **−6.2603**. The
latitude is right and the magnitude matches exactly; only the sign differs, and
the published point falls in the North Sea. It is flagged, excluded from
geographic use, and **not silently corrected** — see
[DATA_QUALITY.md](DATA_QUALITY.md).

---

## 2. The question that can be asked

Site identity is a *perfect* encoding of location: 12 blocks, no measurement
error, no cloud cover, no resampling. Every site-level contextual variable —
LST, LCZ, built-up density, NDVI — is a lossy compression of it.

So instead of asking "does satellite context help?", which BDG2 cannot answer,
we ask the strictly stronger question:

> **How much is location worth at all, when encoded perfectly?**

Whatever that number is, it is an upper bound on every site-level remote-sensing
variable anyone could compute here. If the ceiling is low, the whole layer is
not worth building for this dataset.

### The ladder

| Rung | Features |
|---|---|
| M0 | seasonal naive: hour × weekday mean |
| M1 | + calendar |
| M2 | + weather and degree-hours |
| M3 | + building attributes: log floor area, use, age, floors |
| **M3′** | **M2 + one-hot site identity** ← the control |

Target `log1p(kWh)`, metrics back-transformed to kWh. Per-building CV(RMSE) and
NMBE (ASHRAE Guideline 14), computed inside each building then aggregated, so
the metric is not dominated by the largest consumers.

### Two tasks, not one

Hourly load is dominated by its own recent past. Measured over all 1381
buildings:

```
persistence R² (predict last hour)   median 0.880
variance left after lag_1            median 12.0%,  p75 19.9%
```

In a model that already has `energy_lag_1`, everything else competes for about
a tenth of the variance. Reporting "context adds nothing" from such a model
would describe the design, not the world. The results below are therefore from
the **cold-start** task: no lags, an unseen building, which is the operational
case where location is all you know.

---

## 3. Results

1210 buildings, 12 blocks, 968,000 rows, 3 seeds, 4 protocols.

### CV(RMSE) %, lower is better

| Model | random | temporal | leave-buildings-out | leave-block-out |
|---|---:|---:|---:|---:|
| M0 seasonal naive | 80.4 | 81.0 | 80.8 | 140.7 |
| M1 calendar | 80.6 | 81.4 | 80.8 | 141.7 |
| M2 weather | 81.4 | 82.0 | 82.0 | 157.8 |
| **M3′ site identity** | **78.0** | **79.1** | **80.0** | **148.8** |
| **M3 building attributes** | **42.7** | **43.7** | **58.5** | **75.7** |

Leave-block-out means are inflated by one fold, `Lamb` (Cardiff), at 1007%.
CV(RMSE) divides by a building's mean, and 16 of Lamb's 70 buildings average
under 5 kWh, the smallest 0.38 kWh — tiny absolute errors become enormous
percentages. Robust summary across the 12 blocks:

| Model | leave-block-out, **median** of 12 blocks |
|---|---:|
| M0 seasonal naive | 78.7 |
| M1 calendar | 78.6 |
| M2 weather | 81.0 |
| **M3′ site identity** | **78.2** |
| **M3 building attributes** | **59.5** |

### The headline contrast

| Added to M2 | CV(RMSE) gain | Relative |
|---|---:|---:|
| Perfect site identity (M3′) | **2.8 pts** | 3.5% |
| Building attributes (M3) | **21.5 pts** | 27% |

**Building attributes are worth 7.7× more than location encoded perfectly.**
M3 beats M2 in **12 of 12** blocks (paired Wilcoxon *p* < 0.001) and beats M3′
in **12 of 12**.

Since every site-level satellite variable is a lossy compression of site
identity, the most an LST/LCZ/NDVI layer could contribute here is the 2.8-point
M3′ gain, and realistically less. That is the negative result, stated as a
measured bound rather than a failure to find something.

### Weather makes transfer *worse*

M1 → M2 under leave-block-out: 78.6 → 81.0. Adding weather **hurts** when
predicting an unseen city (*p* = 0.003, though only 2 of 12 folds improved).
The load–temperature relationship is site-specific — a Phoenix cooling curve
does not transfer to Dublin — so the model fits a response that does not hold
where it is applied. Weather still helps within known sites.

### The protocol gap

Same model, same data, different validation:

| Model | random | leave-block-out | optimism |
|---|---:|---:|---:|
| M2 weather | 81.4 | 157.8 | **−76.3 pts** |
| M3 building | 42.7 | 75.7 | **−32.9 pts** |

Shuffling hourly rows makes the model look roughly **twice as good** as it is on
an unseen city. Any BDG2 result reported under a random split should be read
with this in mind.

---

## 3b. The metered-building task, by forecast horizon

The results above are the *cold-start* case — no meter history, the hardest
setting and the only one where a contextual claim can be tested. For a building
that is already metered, the question is how far ahead you need to predict.

A forecast accuracy figure without its horizon is not a result. Predicting `t+h`
from information available at `t`, the most recent legal reading is `h` hours
before the target, so a longer horizon strictly removes features:

| Horizon | Temporal (2016→2017) | Unseen building | NMBE | Lags available | G14 |
|---|---:|---:|---:|---|:---:|
| 1 hour ahead | **9.26%** | 9.52% | +0.56% | lag 1, 24, 168 | ✔ |
| 24 hours ahead | **16.03%** | 16.21% | +1.18% | lag 24, 168 | ✔ |
| 1 week ahead | **21.43%** | 22.16% | +1.55% | lag 168 | ✔ |
| No history (cold start) | 43.65% | 59.50%¹ | −0.43% | none | ✘ |

¹ the cold-start column is *unseen city*, a stricter test than unseen building.

1381 buildings, 3 seeds. ASHRAE Guideline 14 hourly acceptance is CV(RMSE) ≤ 30%
**and** NMBE within ±10%; all three forecast horizons pass both, a week ahead
included. See [METHOD.md](METHOD.md) §1 for why we treat that as an indicative
benchmark rather than a compliance claim.

### Three things this table settles

**The headline needed its horizon.** Quoting 9.26% alone credited the model with
what persistence already provides: with `lag_1` in hand the task is close to
nowcasting. The day-ahead figure of 16.03% is the operationally meaningful one —
it is the horizon procurement, demand response and plant scheduling actually run
on — and it still sits comfortably inside the standard.

**Recent history substitutes for having seen the building.** At every horizon the
unseen-building column matches the temporal one almost exactly (9.52 vs 9.26,
16.21 vs 16.03, 22.16 vs 21.43). Once a building's own recent readings are
available, whether the model was trained on that building adds essentially
nothing: the lag features already carry what is building-specific.

**All the difficulty is in having no history at all.** The step from a week ahead
(21.43%) to no history (43.65%) roughly doubles the error, and doubles it again
for an unseen city (59.50%). That gap is the whole subject of the cold-start
study — and it is why the contextual question had to be asked there. In a
lag-based model, weather and building attributes together move the number by
less than half a point.

---

## 4. What was measured, and how confidently

| Claim | Evidence | Confidence |
|---|---|---|
| Building attributes dominate | 12/12 blocks, 5/5 building folds, *p* < 0.001 | High |
| Site identity adds little | 2.8 pts median, consistent direction (9/12) | Moderate — fold spread is large |
| Weather hurts cross-city transfer | *p* = 0.003, but only 2/12 folds improved | Moderate |
| Random split is ~2× optimistic | Every model, every rung | High |
| Forecast passes ASHRAE G14 at 1 h, 24 h and 1 week | held-out year, 1381 buildings, 3 seeds, both criteria | High |
| Lags remove 88% of the error | M0 80.5% -> M1 9.5% | High |
| Site-level RS cannot beat 2.8 pts | Follows from M3′ being an upper bound | High (logical, not empirical) |

**Detectability.** With 12 blocks and the observed fold spread, a paired
Wilcoxon test resolves a large effect and misses a small one. The minimum
detectable effect for the M3′-vs-M2 contrast is ~24 CV(RMSE) points, and the
observed effect is 2.8 — so the *magnitude* of the site-identity gain is poorly
determined even though its direction is consistent. This is reported rather than
hidden: the conclusion rests on the gain being small, which the data supports,
not on a precise estimate of how small.

---

## 4b. What the model relies on, and where it is reliable

Permutation importance on held-out 2017 data — the loss in CV(RMSE) when a
column is shuffled. Not XGBoost's `gain`, which is biased toward continuous and
high-cardinality columns and is what ranked a constant `elevation` column second
in the archived V3 model.

| Feature | CV(RMSE) points lost when shuffled |
|---|---:|
| `log_sqm` | **180.4** |
| `building_age` | 17.7 |
| `numberoffloors` | 10.6 |
| `hour` | 5.5 |
| `day_of_week` | 1.8 |
| `dewTemperature` | 1.6 |
| `airTemperature`, `month`, `cdh` | < 1 |
| `cloudCoverage`, `hdh`, `windSpeed` | ≈ 0 |
| `is_weekend` | −0.03 |

The cold-start model is a floor-area model with corrections. That is the
expected physics: for a building you have never metered, size sets the *level*
of consumption and weather only shapes it. `is_weekend` scores slightly negative
— shuffling it marginally helps — meaning it is noise that `day_of_week` already
carries.

This is the third independent line of evidence for the study's main finding.
Building attributes dominate; the variables that would carry urban context are
not where the signal is.

### Area of applicability

The portfolio-wide figure hides large variation in where the model can be
trusted:

| Primary use | n | CV(RMSE) | | Floor area | n | CV(RMSE) |
|---|---:|---:|---|---|---:|---:|
| Healthcare | 25 | **21.2%** | | > 20,000 m² | 140 | **28.8%** |
| Parking | 22 | 27.3% | | 5,000–20,000 m² | 594 | 32.8% |
| Lodging/residential | 146 | 29.4% | | 1,000–5,000 m² | 484 | 41.2% |
| Public services | 143 | 33.4% | | < 1,000 m² | 150 | **48.3%** |
| Education | 528 | 37.7% | | | | |
| Office | 264 | 42.0% | | | | |
| Entertainment | 160 | 45.6% | | | | |
| Other | 21 | 49.7% | | | | |

Large buildings are systematically easier to predict, and mixed-use ("Other") is
hardest. This bears directly on the screening module: a flag on a 40,000 m²
hospital rests on a model performing at 21–29%, while a flag on an 800 m²
mixed-use building rests on one performing at nearly 50%. The same flag does not
carry the same weight, and a deployment should surface that.

---

## 5. Limitations

- **n = 12 blocks.** Every site-level conclusion has this sample size. The
  dataset cannot support more, because it publishes 15 coordinates for 1636
  buildings.
- **CV(RMSE) is unstable for very small consumers.** Lamb demonstrates it. The
  median across blocks is the robust reading.
- **Electricity only.** Chilled water and steam are unresolved git-lfs pointers,
  so cooling load — where a thermal-context hypothesis would be most plausible —
  is untested.
- **One dataset.** These results are about BDG2, not about urban building energy
  modelling in general.
- **The anomaly track is unbuilt.** `electricity_cleaned.csv` already had
  anomalies removed by the dataset authors, so a detector trained on it is
  self-defeating; the raw files are not pulled.

## 6. What would answer the original question

Per-building coordinates. NYC Local Law 84 benchmarking joins to PLUTO on BBL,
giving real building geometry, floor count, year, use and measured EUI for tens
of thousands of buildings. There, a 250 m buffer means something.

The evaluation harness in `app/evaluation/` was written to survive that move:
protocols, metrics, blocking and power analysis are dataset-agnostic. Only the
cohort and the feature groups change.

---

### References

- Miller, C. et al. (2020). *The Building Data Genome Project 2*. Scientific Data 7:368.
- ASHRAE Guideline 14-2014, *Measurement of Energy, Demand, and Water Savings*.
- Wadoux, A. et al. (2021). *Spatial cross-validation is not the right way to evaluate map accuracy.* Ecological Modelling 457.
- Miller, C. et al. (2020). *The ASHRAE Great Energy Predictor III competition.* Science and Technology for the Built Environment.
