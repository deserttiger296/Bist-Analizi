"""Walk-forward learning on MTF lab replays, reported per universe (BIST30/BIST100).

Two learners, both strictly out-of-sample:
1. Rule parameters - signal ages the lab does not cap today:
   ``hourly_max_age`` (1h PU age for EARLY_REACTION), ``session_pending_max_age``
   (4h PU age while its resistance was never broken) and ``consumed_after``
   (4h bars after the first breakout; the lab currently uses 5).
   Each quarter, parameters are chosen only on data that ended ``EMBARGO`` before
   the quarter, then scored on that unseen quarter.
2. An ML scorer (gradient boosting) trained the same way on every bar where a
   1h or 4h PU exists, predicting a positive 5-session excess return.

Returns are excess over the same universe's average at the same 4h block, so a
falling market does not make a signal look bad (or a rising one good).
Rerunning on fresh data re-learns everything; ``learned/mtf_lab_params.json``
records what was learned and whether it beat the current lab out of sample.
The lab does not read that file until the evidence says so.
"""
from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from python_bot.research.mtf_backtest import CACHE_DIR, HORIZONS, universe

TARGET = 5                                   # sessions
EMBARGO = pd.Timedelta(days=14)              # > 10 sessions: no label overlap with test
CURRENT = {"hourly_max_age": None, "session_pending_max_age": None, "consumed_after": 5}
GRID = {"hourly_max_age": [None, 5, 10, 20, 40],
        "session_pending_max_age": [None, 10, 20, 40],
        "consumed_after": [3, 5, 10, 20, None]}
MIN_TRAIN_EVENTS = 15
BUY_STATES = ("FULL_CONFIRMATION", "EARLY_REACTION")
FEATURES = ["h_valid", "h_age", "h_bounce", "h_rsi", "s_valid_raw", "s_age", "s_bounce", "s_rsi",
            "consumed", "bars_since_breakout", "resistance_broken", "above", "dist_res",
            "daily_intact", "daily_forming", "d_rsi", "d_d1_rsi", "d_support_gap",
            "lower_nu", "lower_unbroken"]
LEARNED_PATH = Path(__file__).resolve().parent / "learned" / "mtf_lab_params.json"


def prepare(replay: pd.DataFrame, symbols: List[str]) -> pd.DataFrame:
    df = replay[replay.symbol.isin(symbols) & (replay.state != "REPLAY_ERROR")].copy()
    t = pd.to_datetime(df.t)
    t = t.dt.tz_convert("Europe/Istanbul").dt.tz_localize(None) if t.dt.tz is not None else t
    # Afternoon blocks end at 17:30 or 18:30 depending on Yahoo's last bar.
    df["block"] = t.dt.normalize() + pd.to_timedelta(np.where(t.dt.hour < 15, 870, 1090), unit="min")
    for h in HORIZONS:
        df[f"ex_{h}"] = df[f"fwd_{h}"] - df.groupby("block")[f"fwd_{h}"].transform("mean")
    df["daily_intact"] = df.daily_status.eq("INTACT")
    df["lower_unbroken"] = df.lower_nu & ~df.lower_broken.eq(True)
    return df.sort_values(["symbol", "block"]).reset_index(drop=True)


def reclassify(df: pd.DataFrame, hourly_max_age=None, session_pending_max_age=None,
               consumed_after=5) -> pd.Series:
    """Vectorised mirror of pu30_mtf.classify_pu30_state + lower-TF override."""
    never = pd.Series(False, index=df.index)
    hourly = df.h_valid & (df.h_age <= hourly_max_age if hourly_max_age is not None else ~never)
    since = df.bars_since_breakout
    consumed = since.notna() & (since > consumed_after) if consumed_after is not None else never
    pending_old = (since.isna() & (df.s_age > session_pending_max_age)
                   if session_pending_max_age is not None else never)
    session = df.s_valid_raw & ~consumed & ~pending_old
    daily = df.daily_status
    state = np.select(
        [daily.eq("UNKNOWN"), ~daily.eq("INTACT"), session & df.resistance_broken & df.above,
         hourly & ~session],
        ["DATA_UNAVAILABLE", "DAILY_VETO", "FULL_CONFIRMATION", "EARLY_REACTION"],
        "WAITING_CONFIRMATION")
    lower = ~daily.eq("UNKNOWN") & df.lower_unbroken & ~(session & daily.eq("INTACT"))
    return pd.Series(np.where(lower, "LOWER_TF_NU_PRESSURE", state), index=df.index)


def entries(df: pd.DataFrame, states: pd.Series, state: str) -> pd.DataFrame:
    """Bars where a symbol newly enters ``state`` (a held state is one trade, not many)."""
    previous = states.groupby(df.symbol).shift()
    return df[states.eq(state) & ~previous.eq(state)]


def stats(events: pd.DataFrame, horizon: int = TARGET, seed: int = 7) -> Dict[str, Optional[float]]:
    values = events[f"ex_{horizon}"].dropna()
    out = {"n": int(len(values)), "mean_excess": None, "ci95": None, "hit_rate": None,
           "mean_raw": None, "mae_5": None}
    if len(values) < 2:
        return out
    # Bootstrap over 4h blocks: same-time events are not independent.
    blocks = events.loc[values.index, "block"]
    groups = [g.to_numpy() for _, g in values.groupby(blocks)]
    rng = np.random.default_rng(seed)
    means = [np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))]).mean()
             for _ in range(1000)]
    out.update(mean_excess=float(values.mean()), ci95=[float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))],
               hit_rate=float((values > 0).mean()), mean_raw=float(events.loc[values.index, f"fwd_{horizon}"].mean()),
               mae_5=float(events.loc[values.index, "mae_5"].mean()))
    return out


def quarters(df: pd.DataFrame) -> List[pd.Timestamp]:
    start = df.block.min() + pd.Timedelta(days=180)          # at least ~6 months to learn from
    return list(pd.date_range(start.to_period("Q").start_time + pd.offsets.QuarterBegin(0),
                              df.block.max(), freq="QS"))


def _score(df, params, state):
    events = entries(df, reclassify(df, **params), state)[f"ex_{TARGET}"].dropna()
    return (events.mean(), len(events)) if len(events) >= MIN_TRAIN_EVENTS else (-np.inf, len(events))


def learn_rules(train: pd.DataFrame) -> Dict:
    """Session ages by FULL_CONFIRMATION, then hourly age by EARLY_REACTION."""
    best, best_score = dict(CURRENT), _score(train, CURRENT, "FULL_CONFIRMATION")[0]
    for pending, consumed in itertools.product(GRID["session_pending_max_age"], GRID["consumed_after"]):
        params = dict(best, session_pending_max_age=pending, consumed_after=consumed)
        score = _score(train, params, "FULL_CONFIRMATION")[0]
        if score > best_score:
            best, best_score = params, score
    early_best = _score(train, best, "EARLY_REACTION")[0]
    for age in GRID["hourly_max_age"]:
        params = dict(best, hourly_max_age=age)
        score = _score(train, params, "EARLY_REACTION")[0]
        if score > early_best:
            best, early_best = params, score
    return best


def _xy(df):
    x = df[FEATURES].astype(np.float64)
    return x, (df[f"ex_{TARGET}"] > 0).astype(int)


def walk_forward(df: pd.DataFrame) -> Dict:
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    folds, oos = [], {"current": [], "learned": [], "ml": []}
    candidates = df.h_valid | df.s_valid_raw
    edges = quarters(df) + [df.block.max() + pd.Timedelta(days=1)]
    for start, end in zip(edges[:-1], edges[1:]):
        train, test = df[df.block < start - EMBARGO], df[(df.block >= start) & (df.block < end)]
        if not len(test) or not len(train):
            continue
        params = learn_rules(train)
        fold = {"start": str(start.date()), "end": str(end.date()), "params": params}
        in_test = (df.block >= start) & (df.block < end)
        for name, p in (("current", CURRENT), ("learned", params)):
            # States on the full history so a state held across the fold edge is not a new entry.
            states = reclassify(df, **p)
            for state in BUY_STATES + ("LOWER_TF_NU_PRESSURE",):
                events = entries(df, states, state)
                oos[name].append(events[in_test.loc[events.index]].assign(signal=state))
        # ML scorer on PU bars only, labels known before the embargo.
        tr = train[candidates.loc[train.index] & train[f"ex_{TARGET}"].notna()]
        te = test[candidates.loc[test.index] & test[f"ex_{TARGET}"].notna()]
        if len(tr) >= 500 and tr[f"ex_{TARGET}"].gt(0).nunique() == 2 and len(te):
            model = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200,
                                                   l2_regularization=1.0, random_state=7)
            model.fit(*_xy(tr))
            te = te.assign(score=model.predict_proba(_xy(te)[0])[:, 1],
                           threshold=float(np.median(model.predict_proba(_xy(tr)[0])[:, 1])))
            fold["ml_auc"] = float(roc_auc_score(_xy(te)[1], te.score)) if te[f"ex_{TARGET}"].gt(0).nunique() == 2 else None
            oos["ml"].append(te)
        folds.append(fold)
    return {"folds": folds, **{k: pd.concat(v) if v else pd.DataFrame() for k, v in oos.items()}}


def report_universe(replay: pd.DataFrame, name: str) -> Dict:
    df = prepare(replay, universe(name))
    current_states = reclassify(df, **CURRENT)
    mismatch = df[~current_states.eq(df.state) & ~df.state.eq("DATA_UNAVAILABLE")]
    full_period = {s: stats(entries(df, current_states, s)) for s in
                   ("FULL_CONFIRMATION", "EARLY_REACTION", "LOWER_TF_NU_PRESSURE", "WAITING_CONFIRMATION", "DAILY_VETO")}
    wf = walk_forward(df)
    oos = {}
    for name_ in ("current", "learned"):
        frame = wf[name_]
        oos[name_] = {s: stats(frame[frame.signal == s]) if len(frame) else stats(frame) for s in
                      BUY_STATES + ("LOWER_TF_NU_PRESSURE",)}
    ml = wf["ml"]
    ml_report = {}
    if len(ml):
        ml["quintile"] = ml.groupby(pd.Grouper(key="block", freq="QS")).score.transform(
            lambda s: pd.qcut(s.rank(method="first"), 5, labels=False) if len(s) >= 5 else np.nan)
        ml_report = {
            "auc_by_fold": [f.get("ml_auc") for f in wf["folds"] if "ml_auc" in f],
            "quintiles": {int(q): stats(g) for q, g in ml.groupby("quintile")},
            "all_pu_bars": stats(ml),
        }
        current = wf["current"]
        for state in BUY_STATES:
            events = current[current.signal == state]
            keyed = ml.set_index(["symbol", "block"])[["score", "threshold"]]
            joined = events.join(keyed, on=["symbol", "block"])
            ml_report[f"{state}_ml_pass"] = stats(joined[joined.score >= joined.threshold])
            ml_report[f"{state}_ml_fail"] = stats(joined[joined.score < joined.threshold])
    return {
        "universe": name, "symbols": int(df.symbol.nunique()), "rows": int(len(df)),
        "period": [str(df.block.min()), str(df.block.max())],
        "mirror_mismatches": int(len(mismatch)),
        "state_share": df.state.value_counts(normalize=True).round(4).to_dict(),
        "full_period_current": full_period,
        "walk_forward_folds": wf["folds"],
        "oos": oos, "ml": ml_report,
        "params_learned_on_all_data": learn_rules(df),
    }


def _fmt(s: Dict) -> str:
    if not s.get("n") or s.get("mean_excess") is None:
        return f"n={s.get('n', 0)} | — | — | —"
    lo, hi = s["ci95"]
    return (f"n={s['n']} | {s['mean_excess'] * 100:+.2f}% [{lo * 100:+.2f}, {hi * 100:+.2f}] | "
            f"{s['hit_rate'] * 100:.0f}% | {s['mae_5'] * 100:+.2f}%")


def markdown(reports: List[Dict]) -> str:
    lines = ["# MTF Lab öğrenme raporu", "",
             "Otomatik üretilir: `python -m python_bot.research.mtf_learn`. Getiriler aynı 4S bloğundaki "
             "evren ortalamasına göre **fazla getiri**, 5 seans ufuk; [] %95 bootstrap aralığı. "
             "Walk-forward: her çeyrek yalnız ondan 14 gün önce biten veriden öğrenir.", ""]
    for r in reports:
        lines += [f"## {r['universe'].upper()} — {r['symbols']} hisse, {r['rows']} karar noktası",
                  f"Dönem {r['period'][0][:10]} → {r['period'][1][:10]}. Kural aynası uyuşmazlığı: {r['mirror_mismatches']}.", "",
                  "### Tüm dönem, bugünkü lab kuralları (öğrenme yok — sadece tanı)",
                  "| Durum | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |", "|---|---|---|---|---|"]
        lines += [f"| {k} | {_fmt(v).replace('n=', '', 1)} |" for k, v in r["full_period_current"].items()]
        lines += ["", "### Görülmemiş dönemler (walk-forward OOS)",
                  "| Sinyal | Kurallar | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |", "|---|---|---|---|---|---|"]
        for state in BUY_STATES + ("LOWER_TF_NU_PRESSURE",):
            for which in ("current", "learned"):
                lines.append(f"| {state} | {'bugünkü' if which == 'current' else 'öğrenilen'} | "
                             f"{_fmt(r['oos'][which][state]).replace('n=', '', 1)} |")
        lines += ["", "Çeyrek bazında öğrenilen parametreler:", ""]
        lines += [f"- {f['start']}: {f['params']}" + (f", ML AUC={f['ml_auc']:.3f}" if f.get("ml_auc") else "")
                  for f in r["walk_forward_folds"]]
        if r["ml"]:
            lines += ["", "### ML skorlayıcı (OOS)", "| Grup | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |", "|---|---|---|---|---|",
                      f"| Tüm PU barları | {_fmt(r['ml']['all_pu_bars']).replace('n=', '', 1)} |"]
            lines += [f"| Skor beşlisi {q + 1} | {_fmt(v).replace('n=', '', 1)} |" for q, v in r["ml"]["quintiles"].items()]
            for state in BUY_STATES:
                lines += [f"| {state} + ML geçti | {_fmt(r['ml'][f'{state}_ml_pass']).replace('n=', '', 1)} |",
                          f"| {state} + ML kaldı | {_fmt(r['ml'][f'{state}_ml_fail']).replace('n=', '', 1)} |"]
        lines += ["", f"Tüm veriyle öğrenilen kurallar (sonraki dönem için aday): `{r['params_learned_on_all_data']}`", ""]
    lines += ["## Sınırlar", "- Yahoo 1S geçmişi ~2-3 yıl; 15D geçmişi 60 gün olduğu için geçmiş testte alt periyot NU yalnız 1S'ten.",
              "- Evrenler bugünkü endeks listeleri (hayatta kalan yanlılığı).",
              "- İşlem maliyeti/kayma düşülmedi; giriş bir sonraki 1S barın açılışı.",
              "- Sonuçlar geçmiş performanstır, gelecek getiriyi garanti etmez."]
    return "\n".join(lines) + "\n"


def adopt(report: Dict) -> bool:
    """Learned rules replace the lab's only if they beat it out of sample, with a CI above zero."""
    learned = report["oos"]["learned"]["FULL_CONFIRMATION"]
    current = report["oos"]["current"]["FULL_CONFIRMATION"]
    return bool(learned["n"] >= 30 and learned["mean_excess"] is not None and learned["ci95"][0] > 0
                and (current["mean_excess"] is None or learned["mean_excess"] > current["mean_excess"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--replay", default=str(CACHE_DIR / "replay.pkl"))
    parser.add_argument("--universes", default="bist30,bist100")
    parser.add_argument("--markdown", default="docs/MTF_LAB_OGRENME_RAPORU.md")
    args = parser.parse_args()
    replay = pd.read_pickle(args.replay)
    reports = [report_universe(replay, name) for name in args.universes.split(",")]
    (CACHE_DIR / "learn_report.json").write_text(json.dumps(reports, indent=1, default=str))
    Path(args.markdown).write_text(markdown(reports))
    LEARNED_PATH.parent.mkdir(exist_ok=True)
    LEARNED_PATH.write_text(json.dumps({
        "generated_from": [str(replay.t.min()), str(replay.t.max())],
        "current_lab": CURRENT,
        "universes": {r["universe"]: {"learned": r["params_learned_on_all_data"], "adopt": adopt(r),
                                      "oos_full_confirmation": r["oos"]["learned"]["FULL_CONFIRMATION"]}
                      for r in reports},
    }, indent=1, default=str) + "\n")
    print(markdown(reports))


if __name__ == "__main__":
    main()
