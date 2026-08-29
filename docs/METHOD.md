# Method: what each choice rests on

Every threshold, metric and protocol in this project is either taken from an
established standard or chosen by us. This document says which is which, because
a number whose provenance is "the author picked it" should be labelled that way.

---

## 1. Accuracy metrics — ASHRAE Guideline 14

We report **CV(RMSE)** and **NMBE**, computed per building and then aggregated.

ASHRAE Guideline 14-2014 sets acceptance criteria for calibrating whole-building
energy models against measured data:

| Data interval | CV(RMSE) | NMBE |
|---|---:|---:|
| Hourly | ≤ 30% | −10% to +10% |
| Monthly | ≤ 15% | −5% to +5% |

**Both criteria matter, and we report both.** CV(RMSE) measures scatter; NMBE
measures systematic bias. A model can pass one and fail the other: cancelling
errors give a near-zero NMBE with a large CV(RMSE), and a small consistent
offset does the reverse.

### How we use it, and the caveat

Guideline 14 governs *calibration* — fitting a model to a building's observed
data for measurement and verification. We are doing *out-of-sample forecasting*,
which is a different and generally harder task, so we treat the thresholds as an
**indicative benchmark rather than a compliance claim**. Passing them on held-out
data is a stronger result than passing them in calibration; it is not the same
result.

### Why per building rather than pooled

Mean consumption across this portfolio spans roughly 33 to 2048 kWh. A pooled
RMSE is dominated by the largest consumers, so it mostly measures floor area.
Sprint 1 quantified the consequence: predicting each building's constant mean —
no model at all — scores R² = 0.8128 pooled on absolute kWh. Computing the
metric inside each building and then aggregating removes that at the metric
level, which is cleaner than reshaping the target to compensate.

---

## 2. Forecast horizon — stated, not assumed

A forecast accuracy figure is meaningless without its horizon. Predicting
`t+h` from information available at `t`, the most recent legal reading is `h`
hours before the target:

| Horizon | Lags the model may use |
|---|---|
| 1 hour | `lag_1`, `lag_24`, `lag_168` |
| 24 hours | `lag_24`, `lag_168` |
| 1 week | `lag_168` |
| No history (cold start) | none |

Rolling means are shifted by the horizon as well. Using `lag_1` to predict a
week ahead would be leakage, and three unit tests assert it cannot happen.

This matters because persistence alone explains a median 88% of hourly variance
across the 1381 buildings. A one-hour-ahead figure quoted without its horizon
credits the model with what persistence already provides.

---

## 3. Benchmark context — GEPIII

The ASHRAE **Great Energy Predictor III** competition (Kaggle, 2019) used a
subset of this same dataset: 2,380 meters from 1,448 buildings, over 20 million
training points, with 4,370 participants across 3,614 teams submitting 39,403
predictions. Top solutions achieved RMSLE ≤ 0.1 on 79.1% of test data, with
RMSLE > 0.3 on 4.8%.

**GEPIII is not directly comparable to our forecast task, and is closer to our
cold-start task — but easier than it.** Competitors predicted a future period,
so recent lags were unavailable; that resembles our cold-start setting. But
competitors *knew which building they were predicting* and had its full history
from the training year. Our cold-start model has never seen the building at all.

The metric also differs — RMSLE against CV(RMSE) — so any comparison must
recompute one in terms of the other rather than placing the numbers side by side.

The competition's own error analysis (Miller et al., 2021) is the reference for
where machine learning fails on this data, and is worth reading alongside our
per-city results: both find that error concentrates in a minority of buildings
rather than spreading evenly.

---

## 4. Screening — peer-group benchmarking

Our screening rule is not novel, and should not be presented as such. It is the
logic of **ENERGY STAR Portfolio Manager** applied to hourly data.

ENERGY STAR establishes peer groups by building activity using CBECS, then fits
a regression between building attributes and energy use to predict what a
building *should* consume given its climate and activity, with 5–7 factor
variables per building type. A score of 50 means the building performs better
than half its peers; 75 or above places it in the top quartile.

Our two tests map onto that directly:

| Ours | ENERGY STAR equivalent |
|---|---|
| Category peer test (median EUI for its `primaryspaceusage`) | peer group by building activity |
| Model peer test (gradient boosting on attributes + weather) | attribute regression predicting expected use |
| Peer 75th percentile as the diagnostic flag threshold | top-quartile cut used for the score |

**What we add:** hourly resolution. ENERGY STAR works on annual totals, so it
can say a building consumes too much but not *when*. That is what §5 is for.

**Where we sit in the literature:** *EnergyStar++* (Arjunan, Poolla and Miller)
argues for exactly this direction — replacing the linear peer regression with
machine learning to gain accuracy and explanatory power. Notably, that work
comes from the same lab that published BDG2.

### Chosen by us, not inherited

- **2.0× the category median** as the screening threshold. Adjustable in the UI;
  the tables report how the count changes with it.
- **15% minimum margin above the peer median** before a shape metric is flagged,
  so a building barely above a tight distribution is left alone.
- **Requiring both tests to agree.** This is a deliberate conservatism, not a
  standard: on 2017 the category test alone flags 249 of 1347 buildings, and
  adding the model test cuts that to 79. Every name on the list costs someone a
  site visit.

### Validation without ground truth

We have no audit outcomes to check against, so we test the one property that can
be tested: **does the rule survive being computed on a different year?**
Independently per year, using only that year's data and that year's peer medians:

| | Value |
|---|---:|
| Buildings with both years usable | 1332 |
| Flagged in 2016 | 232 |
| Flagged in 2017 | 245 |
| Flagged in both | 220 |
| **Persistence** | **94.8%** |
| Peer-ratio correlation between years | r = 0.988 (Spearman 0.967) |

This shows the signal is structural rather than year-to-year noise, which is
what a triage list needs. **It does not show a building is wasteful** — a data
centre sits persistently above its category median because of what it is.

A supporting property from the accuracy work: the cold-start model is nearly
unbiased even where it is imprecise (NMBE −0.36% temporal, +1.36% for an unseen
city, against CV(RMSE) of 43.7% and 59.5%). It is poor at any single building
and close to unbiased across a portfolio — which is the property the aggregate
excess figures depend on.

---

## 5. Diagnostics — load-shape analysis

Annual benchmarking says a building uses too much. Shape says *when*, which is
what separates a controls problem from a fabric or plant problem.

| Metric | What it is | Standard practice it echoes |
|---|---|---|
| `base_peak` | 5th over 95th percentile of hourly demand | base-load analysis in energy auditing |
| `night_day` | 22:00–06:00 over occupied weekday hours | out-of-hours / setback checks |
| `weekend_weekday` | weekend mean over weekday mean | schedule and holiday-calendar checks |
| `summer_shoulder`, `winter_shoulder` | seasonal means against shoulder months | a coarse stand-in for change-point (ASHRAE IMT) weather-dependence models |

The seasonal ratios are deliberately crude. A proper treatment fits change-point
models to separate baseload, heating and cooling slopes; ours approximates that
with month groupings and should be described as a screening heuristic, not as
change-point analysis.

**Every metric is judged against peers, never absolutely.** A base-to-peak ratio
of 0.41 is unremarkable for a hospital and poor for a primary school.

**Every finding carries what would refute it.** A high overnight load is as
consistent with a data centre, a 24-hour clinic or lab freezers as with a
scheduling fault, and the interface says so on every card. These are hypotheses
for a site visit, in the spirit of a preliminary walk-through audit — not
conclusions about a building.

---

## 6. Validation protocols

Four splits are reported side by side rather than one being declared correct.

| Protocol | Question it answers |
|---|---|
| Random | none, honestly — included to measure the optimism it produces |
| Temporal (2016 → 2017) | how well do we forecast for a building we already meter? |
| Leave-buildings-out | cold start within known sites |
| Leave-block-out | transfer to an unseen city |

Wadoux et al. (2021) argue that spatial cross-validation is not automatically
the honest choice, and that validation should match the prediction domain being
claimed. We take that seriously: the strictest protocol is reported for a
cold-start claim, and the gap between protocols is itself reported, because the
same model looks roughly twice as good under a random split as it does on an
unseen city.

**Blocks, not sites.** Sites closer together than BDG2's own 40 km positional
uncertainty are merged, since holding out one London site while training on two
others does not test transfer to an unseen city. This takes 15 coordinate-bearing
sites to 12 independent blocks.

**Statistical reporting.** Paired Wilcoxon on matched folds, bootstrap intervals
on every aggregate, and the minimum detectable effect at the observed fold
spread — because "no significant difference" is a null result only if the design
could have found the effect.

---

## References

- ASHRAE Guideline 14-2014, *Measurement of Energy, Demand, and Water Savings*.
- Miller, C. et al. (2020). *The Building Data Genome Project 2*. **Scientific Data** 7:368.
- Miller, C. et al. (2020). *The ASHRAE Great Energy Predictor III competition: Overview and results*. **Science and Technology for the Built Environment**. [arXiv:2007.06933](https://arxiv.org/abs/2007.06933)
- Miller, C. et al. (2021). *Limitations of machine learning for building energy prediction: GEPIII error analysis*. [arXiv:2106.13475](https://arxiv.org/abs/2106.13475)
- Arjunan, P., Poolla, K., Miller, C. *EnergyStar++: Towards more accurate and explanatory building energy benchmarking*. [arXiv:1910.14563](https://arxiv.org/pdf/1910.14563)
- US EPA. *ENERGY STAR Score Technical Reference* — [how the 1–100 score is calculated](https://www.energystar.gov/buildings/benchmark/understand-metrics/how-score-calculated).
- Wadoux, A. et al. (2021). *Spatial cross-validation is not the right way to evaluate map accuracy*. **Ecological Modelling** 457.
