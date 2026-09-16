# -*- coding: utf-8 -*-
"""
Hidden Markov Model Market Regime Detection

Replaces the sklearn GaussianMixture regime classifier that originally lived
in main.py's /api/regime endpoint. A Gaussian Mixture Model treats every
(return, volatility) observation as i.i.d. and has no notion of which regime
came before which -- it just clusters points in feature space. A Hidden
Markov Model is the more principled choice for a *time series* regime
problem: it explicitly models regimes as latent states with a transition
matrix, so "yesterday was a crisis regime" informs "today is more likely to
still be a crisis regime" (persistence), which is how real market regimes
actually behave. GaussianHMM was kept as a drop-in replacement rather than
offered as a second parallel endpoint, to avoid a confusing dual API surface
for what is fundamentally the same classification task.
"""
import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from typing import Any, Dict


def classify_regime_hmm(close: pd.Series, n_states: int = 3, random_state: int = 42) -> Dict[str, Any]:
    """
    Fits a Gaussian HMM on (log return, rolling volatility) features and
    classifies the most recent bar's market regime.

    :param close: Chronological closing price series.
    :param n_states: Number of hidden regimes (default 3: low/med/high vol).
    """
    returns = np.log(close / close.shift(1)).dropna()
    volatility = returns.rolling(20).std().dropna()

    common_idx = returns.index.intersection(volatility.index)
    features = np.column_stack([
        returns.loc[common_idx].values.astype(np.float64),
        volatility.loc[common_idx].values.astype(np.float64),
    ])

    if len(features) < n_states * 5:
        raise ValueError("Insufficient observations to fit a stable HMM regime model.")

    model = GaussianHMM(n_components=n_states, covariance_type="diag",
                         n_iter=200, random_state=random_state)
    model.fit(features)

    states = model.predict(features)
    latest_state = int(states[-1])

    # Order hidden states by their volatility mean so labels are consistent
    # regardless of which internal state index the HMM happened to assign.
    vol_means = model.means_[:, 1]
    vol_rank = np.argsort(vol_means)  # ascending: [low, mid, ..., high]

    labels = ["YATAY", "TREND", "KRİZ"]
    if n_states != 3:
        labels = [f"REGIME_{i}" for i in range(n_states)]
    regime_map = {int(vol_rank[i]): labels[i] for i in range(n_states)}

    predicted_regime = regime_map.get(latest_state, labels[0])

    # Posterior probability of the current state (confidence), and the
    # transition-matrix-implied probability of staying in this regime next
    # step, which is the extra signal an HMM gives over a GMM.
    posteriors = model.predict_proba(features)
    confidence = float(posteriors[-1, latest_state])
    persistence_prob = float(model.transmat_[latest_state, latest_state])

    return {
        "regime": predicted_regime,
        "confidence": confidence,
        "regime_persistence_prob": persistence_prob,
        "volatility_annualized": float(volatility.iloc[-1] * np.sqrt(252)),
        "momentum_20d": float((close.iloc[-1] - close.iloc[-20]) / close.iloc[-20]),
        "model": "GaussianHMM",
        "n_states": n_states,
    }
