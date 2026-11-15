# -*- coding: utf-8 -*-
import math
import numpy as np
import pytest

from python_bot.engine.shield.expected_value import ExpectedValueFilter
from python_bot.engine.shield.kelly_sizing import KellySizingEngine
from python_bot.engine.shield.risk_var import ValueAtRiskModel


# ====================================================================
# 1. ExpectedValueFilter Tests
# ====================================================================
def test_ev_filter_backward_compatibility_and_roundtrip_cost():
    ev_filter = ExpectedValueFilter(min_ev_threshold=0.5, default_roundtrip_cost_pct=0.0)
    # 60% win prob, 5% target, 3% stop => gross EV = 0.6*5 - 0.4*3 = 3.0 - 1.2 = 1.8%
    res_gross = ev_filter.evaluate_trade(win_probability=0.60, target_profit_pct=5.0, stop_loss_pct=3.0)
    assert res_gross["status"] == "AUTHORIZED"
    assert res_gross["is_authorized"] is True
    assert math.isclose(res_gross["expected_value_pct"], 1.8, rel_tol=1e-6)
    assert math.isclose(res_gross["gross_expected_value_pct"], 1.8, rel_tol=1e-6)
    assert math.isclose(res_gross["reward_to_risk"], 5.0 / 3.0, rel_tol=1e-6)

    # With BIST roundtrip cost (commission + BSMV + slippage = 0.25%)
    res_net = ev_filter.evaluate_trade(
        win_probability=0.60, target_profit_pct=5.0, stop_loss_pct=3.0, roundtrip_cost_pct=0.25
    )
    assert math.isclose(res_net["expected_value_pct"], 1.8 - 0.25, rel_tol=1e-6)
    assert math.isclose(res_net["roundtrip_cost_pct"], 0.25, rel_tol=1e-6)
    assert math.isclose(res_net["net_reward_to_risk"], (5.0 - 0.25) / (3.0 + 0.25), rel_tol=1e-6)


def test_ev_filter_cost_blocks_marginal_trade():
    # Gross EV = 0.5*2.0 - 0.5*1.8 = 0.10% (>0), but 0.20% BIST roundtrip cost makes net EV = -0.10%
    ev_filter = ExpectedValueFilter(min_ev_threshold=0.0, default_roundtrip_cost_pct=0.20)
    res = ev_filter.evaluate_trade(win_probability=0.50, target_profit_pct=2.0, stop_loss_pct=1.8)
    assert res["is_authorized"] is False
    assert res["status"] == "BLOCKED_NEGATIVE_EXPECTATION"
    assert math.isclose(res["expected_value_pct"], -0.10, abs_tol=1e-6)


@pytest.mark.parametrize(
    "bad_prob,bad_target,bad_stop",
    [
        (-0.1, 5.0, 3.0),
        (1.2, 5.0, 3.0),
        (float("nan"), 5.0, 3.0),
        (float("inf"), 5.0, 3.0),
        (0.5, float("nan"), 3.0),
        (0.5, 5.0, float("-inf")),
    ],
)
def test_ev_filter_invalid_inputs_rejected(bad_prob, bad_target, bad_stop):
    ev_filter = ExpectedValueFilter(min_ev_threshold=0.0)
    res = ev_filter.evaluate_trade(bad_prob, bad_target, bad_stop)
    assert res["is_authorized"] is False
    assert res["status"] == "INVALID_INPUT"


# ====================================================================
# 2. KellySizingEngine Tests
# ====================================================================
def test_kelly_zero_and_negative_capital_no_zero_division():
    kelly = KellySizingEngine(default_fraction=0.5, max_position_pct=0.15)
    for bad_cap in (0.0, -1000.0, float("nan"), float("inf")):
        res = kelly.calculate_allocation(
            win_probability=0.60,
            reward_to_risk=2.0,
            total_capital=bad_cap,
            current_cash=5000.0,
        )
        assert res["status"] == "REJECTED"
        assert res["recommended_capital"] == 0.0
        assert res["recommended_pct"] == 0.0


def test_kelly_cash_limited_and_sentiment_brake():
    kelly = KellySizingEngine(default_fraction=0.5, max_position_pct=0.20)
    # p=0.6, R=2.0 => raw_kelly = (0.6*3 - 1)/2 = 0.40 => half_kelly = 0.20
    # With panic sentiment (-0.5 on LONG), penalty = 0.5 => final_pct = 0.10 (10,000 TL on 100,000 TL)
    res_panic = kelly.calculate_allocation(
        win_probability=0.60,
        reward_to_risk=2.0,
        total_capital=100_000.0,
        current_cash=50_000.0,
        sentiment_score=-0.5,
        trade_direction="LONG",
    )
    assert res_panic["status"] == "APPROVED"
    assert res_panic["sentiment_penalty_applied"] is True
    assert math.isclose(res_panic["recommended_pct"], 10.0, rel_tol=1e-6)
    assert math.isclose(res_panic["recommended_capital"], 10_000.0, rel_tol=1e-6)

    # Cash limited scenario (only 4,000 TL cash available)
    res_cash = kelly.calculate_allocation(
        win_probability=0.60,
        reward_to_risk=2.0,
        total_capital=100_000.0,
        current_cash=4_000.0,
        sentiment_score=0.0,
    )
    assert res_cash["status"] == "APPROVED_CASH_LIMITED"
    assert math.isclose(res_cash["recommended_capital"], 4_000.0, rel_tol=1e-6)
    assert math.isclose(res_cash["recommended_pct"], 4.0, rel_tol=1e-6)


# ====================================================================
# 3. ValueAtRiskModel (VaR & CVaR / Expected Shortfall) Tests
# ====================================================================
def test_var_and_cvar_parametric_and_historical_with_bist_tail_shocks():
    np.random.seed(42)
    base_returns = np.random.normal(0.001, 0.02, 245)
    bist_taban_shocks = np.array([-0.099, -0.10, -0.098, -0.095, -0.10])
    returns = np.concatenate([base_returns, bist_taban_shocks])

    model = ValueAtRiskModel(confidence_level=0.99)
    p_res = model.calculate_parametric_var(portfolio_value=500_000.0, historical_returns=returns, holding_period_days=1)
    h_res = model.calculate_historical_var(portfolio_value=500_000.0, historical_returns=returns, holding_period_days=1)

    assert p_res["status"] == "SUCCESS"
    assert h_res["status"] == "SUCCESS"
    # CVaR (Expected Shortfall) must always be >= VaR
    assert p_res["cvar_pct"] >= p_res["var_pct"] > 0.0
    assert p_res["cvar_absolute"] >= p_res["var_absolute"] > 0.0
    assert h_res["cvar_pct"] >= h_res["var_pct"] > 0.0
    assert h_res["cvar_absolute"] >= h_res["var_absolute"] > 0.0


def test_ev_filter_negative_cost_rejected():
    ev_filter = ExpectedValueFilter(min_ev_threshold=0.0)
    res = ev_filter.evaluate_trade(win_probability=0.60, target_profit_pct=1.0, stop_loss_pct=1.0, roundtrip_cost_pct=-0.5)
    assert res["is_authorized"] is False
    assert res["status"] == "INVALID_INPUT"


def test_var_nan_inf_sanitization_and_insufficient_data():
    model = ValueAtRiskModel(confidence_level=0.95)
    dirty_returns = np.array([-0.05, -0.02, 0.01, 0.02, 0.03, -0.04, float("nan"), float("inf"), float("-inf")])
    res = model.calculate_historical_var(portfolio_value=100_000.0, historical_returns=dirty_returns)
    assert res["status"] == "SUCCESS"
    assert math.isfinite(res["var_pct"]) and math.isfinite(res["cvar_pct"])

    # Only 3 valid finite values after stripping NaN/inf -> INSUFFICIENT_DATA
    too_short = np.array([-0.02, 0.01, 0.02, float("nan"), float("inf")])
    res_short = model.calculate_parametric_var(portfolio_value=100_000.0, historical_returns=too_short)
    assert res_short["status"] == "INSUFFICIENT_DATA"
    assert res_short["var_pct"] == 0.0
    assert res_short["cvar_pct"] == 0.0

    # 2D matrix (3x2 = 6 elements) or non-numeric input must be rejected as INVALID_INPUT
    mat_2d = np.array([[-0.02, 0.01], [0.02, -0.01], [0.03, -0.02]])
    res_2d = model.calculate_parametric_var(portfolio_value=100_000.0, historical_returns=mat_2d)
    assert res_2d["status"] == "INVALID_INPUT"
    res_bad = model.calculate_historical_var(portfolio_value=100_000.0, historical_returns=["bad", "data"])
    assert res_bad["status"] == "INVALID_INPUT"
