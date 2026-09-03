"""Check that the published dashboard still shows what the analysis produced.

`export_web_data.py` freezes API responses into files the page reads. Frozen
data goes stale silently: the experiments get re-run, the model is retrained,
and the page keeps serving last month's numbers under this month's labels with
nothing to indicate it. This script is the guard against that, and it checks
three joints in the chain rather than one:

1. **API to file.** Every exported response is re-requested and compared byte
   for byte. A difference means the export is out of date -- or that an
   endpoint has changed behaviour since it ran.

2. **Analysis to API.** The headline CV(RMSE) matrix is recomputed here,
   directly from ``results/ladder/*/fold_results.csv``, and compared with what
   the summary endpoint reports. This is deliberately a second implementation:
   the point is to disagree with `results_api` if `results_api` is wrong, which
   a check that called it could never do.

3. **API to prose.** The numbers asserted in README.md are matched against the
   values just verified. The README is where a number is most likely to be
   left behind, because nothing executes it.

The dataset and `results/` are not in git, so this cannot run in CI. Run it
after re-exporting, before committing.

Usage (from ``ai-service/``)::

    python -m scripts.verify_web_data              # full: every exported file
    python -m scripts.verify_web_data --quick      # skip per-building details
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

DEFAULT_DATA = os.path.join("..", "frontend", "public", "data")
DEFAULT_README = os.path.join("..", "README.md")

# Endpoint stems that read the parquet partitions. Comparing all of them means
# re-reading 276 MB per site, so --quick samples instead.
SLOW_PREFIXES = ("explore/building/", "diagnose/", "anomaly/", "explore/site/")

# The URL each exported stem came from. Mirrors the export; a stem the export
# can write and this cannot address would go unchecked, which is why the
# fallthrough raises instead of skipping.
def url_for(stem):
    if stem == "health":
        return "/api/health"
    if stem == "results/tasks":
        return "/api/results/tasks"
    if stem == "explore/eui-by-use":
        return "/api/explore/eui-by-use"
    if stem.startswith("results/"):
        return "/api/" + stem
    if stem.startswith("screening/"):
        threshold = stem.split("/", 1)[1]
        return "/api/screening?threshold={}&limit=40".format(float(threshold))
    if stem.startswith("explore/building/"):
        return "/api/{}?year=2017".format(stem)
    if stem.startswith("explore/site/"):
        return "/api/{}?year=2017".format(stem)
    if stem.startswith("diagnose/"):
        return "/api/{}?year=2017".format(stem)
    if stem.startswith("anomaly/"):
        return "/api/{}?sigma=3.0".format(stem)
    raise ValueError("No URL known for exported stem {!r}".format(stem))


class Report:
    def __init__(self):
        self.checks = 0
        self.failures = []

    def check(self, ok, label, detail=""):
        self.checks += 1
        if not ok:
            self.failures.append((label, detail))
        return ok

    def section(self, name):
        print("\n--- {} ---".format(name), flush=True)

    def ok(self, label, value=""):
        print("  ok   {} {}".format(label, value), flush=True)

    def bad(self, label, detail):
        print("  FAIL {}: {}".format(label, detail), flush=True)


def recompute_matrix(task):
    """CV(RMSE) per protocol and model, straight from the harness output.

    Mean over seeds within a fold, then median across folds -- the aggregation
    `results_api.summary` documents. Written out here rather than imported so
    that a change in one is not silently blessed by the other.
    """
    import pandas as pd

    path = os.path.join("results", "ladder", task, "fold_results.csv")
    df = pd.read_csv(path)
    per_fold = df.groupby(["protocol", "model", "fold"], as_index=False)["cv_rmse_median"].mean()
    out = {}
    for (protocol, model), g in per_fold.groupby(["protocol", "model"]):
        out.setdefault(model, {})[protocol] = {
            "median": round(float(g["cv_rmse_median"].median()), 1),
            "mean": round(float(g["cv_rmse_median"].mean()), 1),
            "n_folds": int(len(g)),
        }
    return out


def verify(data_dir=DEFAULT_DATA, readme=DEFAULT_README, quick=False):
    from fastapi.testclient import TestClient

    from scripts.export_web_data import _install_in_memory_buildings, _buildings_response

    from app.model_metrics import MEAN_KEY

    rep = Report()
    # Conditions that are true, understood, and not failures -- but that
    # nobody should have to rediscover by reading the source.
    legacy_naming = []
    table = _install_in_memory_buildings()

    from app.main import app

    manifest_path = os.path.join(data_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise SystemExit("No export at {}. Run scripts.export_web_data first.".format(data_dir))
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    print("export generated at {} ({} files)".format(
        manifest["generated_at"], manifest["n_files"]))

    with TestClient(app, raise_server_exceptions=False) as client:

        # -- 1. every frozen file still equals what the API answers ----------
        rep.section("frozen responses against the live API")
        stems = list(manifest["files"])
        slow = [s for s in stems if s.startswith(SLOW_PREFIXES)]
        fast = [s for s in stems if not s.startswith(SLOW_PREFIXES)]

        def site_of(stem):
            if stem.startswith("explore/site/"):
                return stem.split("/")[2]
            if stem.startswith("explore/building/"):
                bid = stem.split("/")[2]
            elif stem.startswith(("diagnose/", "anomaly/")):
                bid = stem.split("/", 1)[1]
            else:
                return ""
            row = table.get(bid)
            return row["site_id"] if row else ""

        # Manifest order is alphabetical, which walks every site once per
        # endpoint prefix -- all 352 anomaly scans, then all 352 diagnoses --
        # while explore_api keeps only a few partitions hot. Grouping by site
        # reads each 20-60 MB parquet file once instead of hundreds of times.
        slow.sort(key=lambda stem: (site_of(stem), stem))

        checked = list(fast)
        if quick:
            # One endpoint per site, so every partition is still touched once.
            seen = set()
            for stem in slow:
                key = (stem.split("/")[0], site_of(stem))
                if key[1] and key not in seen:
                    seen.add(key)
                    checked.append(stem)
        else:
            checked.extend(slow)

        mismatched = 0
        last_site = None
        for i, stem in enumerate(checked, 1):
            site = site_of(stem)
            if site and site != last_site:
                last_site = site
                print("  [{}/{}] site {}".format(i, len(checked), site), flush=True)
            if stem == "buildings":
                live = json.dumps(_buildings_response(table, 300), ensure_ascii=False,
                                  allow_nan=False, separators=(",", ":")).encode("utf-8")
            elif stem == "model/attributes":
                continue  # assembled by the exporter, covered by the parity test
            else:
                resp = client.get(url_for(stem))
                if resp.status_code != 200:
                    rep.check(False, stem, "live API now answers {}".format(resp.status_code))
                    rep.bad(stem, "live API now answers {}".format(resp.status_code))
                    mismatched += 1
                    continue
                live = resp.content

            with open(os.path.join(data_dir, *stem.split("/")) + ".json", "rb") as fh:
                frozen = fh.read()

            if not rep.check(live == frozen, stem, "frozen bytes differ from the live response"):
                rep.bad(stem, "frozen bytes differ from the live response")
                mismatched += 1

        rep.ok("{} of {} exported responses byte-identical".format(
            len(checked) - mismatched, len(checked)),
            "({} not re-checked in --quick)".format(len(stems) - len(checked)) if quick else "")

        # -- 2. the API's matrix against a recomputation from the folds -----
        rep.section("summary endpoint against results/ladder/*/fold_results.csv")
        tasks = [t["key"] for t in client.get("/api/results/tasks").json()["tasks"]]
        headline = {}
        for task in tasks:
            expected = recompute_matrix(task)
            served = client.get("/api/results/{}/summary".format(task)).json()
            headline[task] = {}
            for row in served["matrix"]:
                model = row["model"]
                for protocol, cell in row.items():
                    if protocol in ("model", "label") or cell is None:
                        continue
                    want = expected.get(model, {}).get(protocol)
                    label = "{}/{}/{}".format(task, model, protocol)
                    if want is None:
                        rep.check(False, label, "served a cell the folds do not contain")
                        rep.bad(label, "served a cell the folds do not contain")
                        continue
                    for key in ("median", "mean", "n_folds"):
                        if not rep.check(cell[key] == want[key], label + "." + key,
                                         "served {}, folds give {}".format(cell[key], want[key])):
                            rep.bad(label + "." + key,
                                    "served {}, folds give {}".format(cell[key], want[key]))
                    headline[task][(model, protocol)] = cell["median"]
            rep.ok(task, "{} models x protocols agree with the raw folds".format(
                len(served["matrix"])))

        # -- 3. README's numbers against those values -----------------------
        rep.section("README headline numbers")
        with open(readme, "r", encoding="utf-8") as fh:
            text = fh.read()

        claims = []

        def claim(label, present, expected, fmt="{}"):
            got = fmt.format(expected)
            claims.append((label, got, present))
            if not rep.check(present, label, "README does not carry {}".format(got)):
                rep.bad(label, "expected to find {} in README.md".format(got))
            else:
                rep.ok(label, got)

        day_ahead = headline.get("forecast_h24", {}).get(("M3_building", "temporal"))
        if day_ahead is not None:
            claim("day-ahead CV(RMSE)", "{}%".format(day_ahead) in text, day_ahead, "{}%")

        cold = headline.get("cold_start", {}).get(("M3_building", "temporal"))
        if cold is not None:
            claim("cold-start CV(RMSE)", "{}%".format(cold) in text, cold, "{}%")

        cs = headline.get("cold_start", {})
        m2 = cs.get(("M2_weather", "leave_block_out"))
        m3 = cs.get(("M3_building", "leave_block_out"))
        ident = cs.get(("M3prime_site_identity", "leave_block_out"))
        if None not in (m2, m3, ident):
            attrs = round(m2 - m3, 1)
            location = round(m2 - ident, 1)
            claim("building attributes worth", str(attrs) in text, attrs)
            claim("location worth", str(location) in text, location)
            ratio = round(attrs / location, 1) if location else None
            if ratio:
                claim("the ratio", "{}x".format(ratio) in text or "{}×".format(ratio) in text,
                      ratio, "{}x")

        screening = client.get("/api/screening?threshold=2.0&limit=40").json()["summary"]
        claim("buildings screened", "{:,}".format(screening["n_screened"]) in text,
              screening["n_screened"], "{:,}")
        claim("buildings flagged", str(screening["n_flagged"]) in text, screening["n_flagged"])
        gwh = round(screening["excess_annual_gwh"])
        claim("excess GWh/year", str(gwh) in text, gwh)

        health = client.get("/api/health").json()
        claim("buildings trained on", "{:,}".format(health["trained_on_buildings"]) in text,
              health["trained_on_buildings"], "{:,}")

        # -- 4. counts the prose is easy to get wrong -----------------------
        rep.section("portfolio counts")
        usable = [r for r in table.values() if r["meter_usable"]]
        n_sites = len(set(r["site_id"] for r in usable))
        n_blocks = len(set(r["spatial_block"] for r in usable))
        n_lbo_folds = len(client.get("/api/results/cold_start/by-city").json()["blocks"])
        print("  {} usable buildings across {} sites / {} spatial blocks; "
              "{} blocks have leave-one-city-out results".format(
                  len(usable), n_sites, n_blocks, n_lbo_folds))

        stated = re.search(r"([\d,]+)\s+real buildings across\s+(\d+)\s+cities", text)
        if stated:
            n_stated, cities_stated = stated.group(1), int(stated.group(2))
            if not rep.check(int(n_stated.replace(",", "")) == len(usable),
                             "README building count",
                             "README says {}, data has {}".format(n_stated, len(usable))):
                rep.bad("README building count",
                        "says {}, data has {}".format(n_stated, len(usable)))
            else:
                rep.ok("README building count", n_stated)
            if not rep.check(cities_stated in (n_sites, n_blocks), "README city count",
                             "README says {} cities; the portfolio spans {} sites / {} blocks "
                             "({} of them have leave-one-city-out folds)".format(
                                 cities_stated, n_sites, n_blocks, n_lbo_folds)):
                rep.bad("README city count",
                        "says {} cities; portfolio spans {} sites / {} blocks; {} blocks have "
                        "leave-one-city-out results".format(
                            cities_stated, n_sites, n_blocks, n_lbo_folds))
            else:
                rep.ok("README city count", cities_stated)

        # -- 5. the model's own metrics against the folds -------------------
        rep.section("model metadata against the folds it cites")
        with open(os.path.join("app", "models", "saved",
                               "energy_cold_start_metadata.json"), "r", encoding="utf-8") as fh:
            meta = json.load(fh)
        recomputed = recompute_matrix("cold_start").get(meta["spec"], {})
        near = lambda a, b: abs(a - b) < 0.15  # noqa: E731 - one comparison, used twice

        for protocol, cited in (meta.get("held_out_metrics") or {}).items():
            want = recomputed.get(protocol)
            if not want:
                continue
            label = "metadata {}".format(protocol)

            if MEAN_KEY in cited:
                # Written after the naming was corrected: both statistics are
                # present, and each has to be the one its name claims.
                for key, stat in ((MEAN_KEY, "mean"), ("cv_rmse_median_pct", "median")):
                    value = cited.get(key)
                    if value is None:
                        continue
                    if not rep.check(near(value, want[stat]), "{}.{}".format(label, key),
                                     "{}={} but the fold {} is {}".format(
                                         key, value, stat, want[stat])):
                        rep.bad("{}.{}".format(label, key),
                                "{}={} but the fold {} is {}".format(
                                    key, value, stat, want[stat]))
                    else:
                        rep.ok("{}.{}".format(label, key), value)
                continue

            # Legacy shape: only the mis-named key, holding the fold mean. The
            # service reads it correctly now (app/model_metrics.py resolves it
            # as a mean and says so), and the only way to rewrite the file is
            # to retrain. So this is reported, loudly, and not failed -- a
            # check that is permanently red is a check people stop reading.
            value = cited["cv_rmse_median_pct"]
            if rep.check(near(value, want["mean"]) or near(value, want["median"]), label,
                         "cv_rmse_median_pct={} matches neither the fold median {} "
                         "nor the fold mean {}".format(value, want["median"], want["mean"])):
                if near(value, want["median"]):
                    rep.ok(label, "{} matches the fold median".format(value))
                else:
                    legacy_naming.append(
                        "{}: cv_rmse_median_pct={} is the fold mean; the median is {}".format(
                            protocol, value, want["median"]))
                    rep.ok(label, "{} = the fold mean (legacy field name)".format(value))
            else:
                rep.bad(label, "matches neither the fold median nor the fold mean")

    if legacy_naming:
        print("\n--- known, not a failure ---")
        for line in legacy_naming:
            print("  {}".format(line))
        print("  This model file predates the naming fix. app/model_metrics.py reads it\n"
              "  as the mean it is and labels it so; rewriting the file needs a retrain.")

    print("\n{} checks, {} failed".format(rep.checks, len(rep.failures)))
    if rep.failures:
        print("\nFailures:")
        for label, detail in rep.failures:
            print("  - {}: {}".format(label, detail))
    return rep


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data", default=DEFAULT_DATA)
    p.add_argument("--readme", default=DEFAULT_README)
    p.add_argument("--quick", action="store_true",
                   help="sample one building per site instead of re-checking every one")
    args = p.parse_args(argv)
    rep = verify(data_dir=args.data, readme=args.readme, quick=args.quick)
    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main())
