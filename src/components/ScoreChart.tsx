"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ScoreChartProps {
  stock: {
    ticker: string;
    technicalScore: number;
    fundamentalScore: number;
    macroScore: number;
    sentimentScore: number;
  };
}

export default function ScoreChart({ stock }: ScoreChartProps) {
  const scoreToPercentage = (score: number) => {
    return Math.round((score + 1) * 50);
  };

  const data = [
    {
      name: "Teknik",
      value: scoreToPercentage(stock.technicalScore),
    },
    {
      name: "Temel",
      value: scoreToPercentage(stock.fundamentalScore),
    },
    {
      name: "Makro",
      value: scoreToPercentage(stock.macroScore),
    },
    {
      name: "Duygu",
      value: scoreToPercentage(stock.sentimentScore),
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" stroke="#9ca3af" />
        <YAxis stroke="#9ca3af" />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: "8px",
          }}
          cursor={{ fill: "rgba(59, 130, 246, 0.1)" }}
        />
        <Bar
          dataKey="value"
          fill="#3b82f6"
          radius={[8, 8, 0, 0]}
          isAnimationActive={true}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
