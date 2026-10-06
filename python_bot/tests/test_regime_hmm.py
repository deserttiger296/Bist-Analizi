"""classify_regime_hmm retries a few fixed seeds when EM collapses on one
(seen on 1y windows: AKSEN, ODAS, ... raised "startprob_ must sum to 1")."""
import numpy as np
import pandas as pd
import pytest

from python_bot.engine.brain import regime_hmm


def _close(n=260, seed=3):
    rng = np.random.default_rng(seed)
    return pd.Series(50 * np.exp(np.cumsum(rng.normal(0, 0.02, n))), dtype=np.float64)


def _hmm_failing_for(bad_seeds):
    real = regime_hmm.GaussianHMM
    seen = []

    class FlakyHMM(real):
        def fit(self, X, lengths=None):
            seen.append(self.random_state)
            if self.random_state in bad_seeds:
                raise ValueError("startprob_ must sum to 1 (got nan)")
            return super().fit(X, lengths)

    return FlakyHMM, seen


def test_first_seed_result_is_unchanged_when_it_fits(monkeypatch):
    flaky, seen = _hmm_failing_for(set())
    monkeypatch.setattr(regime_hmm, "GaussianHMM", flaky)
    regime_hmm.classify_regime_hmm(_close())
    assert seen == [42]


def test_retries_next_seed_after_collapse(monkeypatch):
    flaky, seen = _hmm_failing_for({42})
    monkeypatch.setattr(regime_hmm, "GaussianHMM", flaky)
    result = regime_hmm.classify_regime_hmm(_close())
    assert seen == [42, 43]
    assert result["regime"] in {"YATAY", "TREND", "KRİZ"}


def test_raises_when_every_seed_collapses(monkeypatch):
    flaky, seen = _hmm_failing_for(set(range(42, 47)))
    monkeypatch.setattr(regime_hmm, "GaussianHMM", flaky)
    with pytest.raises(ValueError, match="startprob_"):
        regime_hmm.classify_regime_hmm(_close())
    assert seen == [42, 43, 44, 45, 46]


def test_trailing_nan_bar_does_not_leak_into_result():
    close = _close()
    with_nan = pd.concat([close, pd.Series([np.nan], index=[len(close)])])
    result = regime_hmm.classify_regime_hmm(with_nan)
    assert np.isfinite(result["momentum_20d"])
    assert result == regime_hmm.classify_regime_hmm(close)
