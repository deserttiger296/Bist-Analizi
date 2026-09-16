# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 5 Extension: Visual Artifacts Dashboard Generator
"""

import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import pandas as pd
import os

class VisualArtifactGenerator:
    def __init__(self, output_dir: str = "./artifacts"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        # Use a professional, dark trading aesthetic
        plt.style.use('dark_background')

    def plot_var_breach_timeline(self, portfolio_values: np.ndarray, var_limit: float):
        """
        Generates a time-series line chart showing portfolio drops vs VaR limit.
        """
        plt.figure(figsize=(12, 6))
        
        # Calculate daily returns/drawdowns
        drawdowns = (portfolio_values - np.maximum.accumulate(portfolio_values)) / np.maximum.accumulate(portfolio_values)
        
        plt.plot(drawdowns * 100, color='cyan', label='Portfolio Drawdown (%)', linewidth=1.5)
        plt.axhline(y=-var_limit * 100, color='red', linestyle='--', label=f'VaR 99% Limit ({-var_limit*100:.1f}%)')
        
        plt.fill_between(range(len(drawdowns)), drawdowns*100, -var_limit*100, 
                         where=(drawdowns*100 < -var_limit*100), color='red', alpha=0.3, label='VaR Breach')
        
        plt.title("Portfolio Drawdown vs Value at Risk (VaR) Limits")
        plt.xlabel("Time (Trading Days)")
        plt.ylabel("Drawdown %")
        plt.legend()
        plt.grid(alpha=0.2)
        
        out_path = os.path.join(self.output_dir, "var_breach_chart.png")
        plt.savefig(out_path, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Generated Visual Artifact: {out_path}")

    def plot_correlation_heatmap(self, symbols: list, returns_matrix: np.ndarray):
        """
        Generates a heatmap to visualize portfolio asset correlations.
        """
        df = pd.DataFrame(returns_matrix.T, columns=symbols)
        corr_matrix = df.corr()
        
        plt.figure(figsize=(10, 8))
        sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', vmin=-1, vmax=1, center=0, 
                    square=True, linewidths=.5, cbar_kws={"shrink": .8})
        
        plt.title("Portfolio Asset Correlation Heatmap")
        
        out_path = os.path.join(self.output_dir, "correlation_heatmap.png")
        plt.savefig(out_path, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Generated Visual Artifact: {out_path}")

if __name__ == "__main__":
    generator = VisualArtifactGenerator()
    
    # Mock data
    mock_portfolio = 100000 * np.cumprod(1 + np.random.normal(0.0005, 0.015, 100))
    generator.plot_var_breach_timeline(mock_portfolio, var_limit=0.05)
    
    symbols = ["AKBNK", "GARAN", "EREGL", "TUPRS", "BIMAS"]
    mock_returns = np.random.normal(0, 0.02, (5, 100))
    # Make AKBNK and GARAN correlated
    mock_returns[1] = mock_returns[0] + np.random.normal(0, 0.005, 100)
    
    generator.plot_correlation_heatmap(symbols, mock_returns)
