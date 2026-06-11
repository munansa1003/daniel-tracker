import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export function MiniDonut({ value, max, color, size = 72 }) {
  const over = value > max;
  const darkColor = color === "#4a8fc9" ? "#1e3f66" : color === "#d4af37" ? "#7a4a10" : "#801818";
  let data, colors;
  if (!over) {
    const pct = Math.min(value / max, 1);
    data = [{ v: pct }, { v: 1 - pct }];
    colors = [color, "#2a2a2a"];
  } else {
    const overPct = (value - max) / value;
    const basePct = max / value;
    data = [{ v: overPct }, { v: basePct }];
    colors = [darkColor, color];
  }
  return (
    <div style={{ width: size, height: size }}>
      <ResponsiveContainer><PieChart><Pie data={data} dataKey="v" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none">{data.map((_, i) => <Cell key={i} fill={colors[i]} />)}</Pie></PieChart></ResponsiveContainer>
    </div>
  );
}
