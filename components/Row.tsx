/**
 * A receipt line: LABEL ................. value
 * The dotted leader is drawn in CSS (.leader__label::after) and clipped by the
 * row, so it always fills exactly the gap that's left.
 */
export default function Row({
  label,
  value,
  /** Render the value in the stamp colour — status and success only. */
  stamp = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  stamp?: boolean;
}) {
  return (
    <div className="leader">
      <span className="leader__label">{label}</span>
      <span className={stamp ? 'leader__value stamp' : 'leader__value'}>{value}</span>
    </div>
  );
}
