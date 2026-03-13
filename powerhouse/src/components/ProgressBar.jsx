export default function ProgressBar({ value, max, color, label, unit }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-light">{label}</span>
        <span>
          {value}
          {unit ? unit : ''} / {max}
          {unit ? unit : ''}
        </span>
      </div>
      <div className="w-full h-3 rounded-full bg-gray-dark overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
