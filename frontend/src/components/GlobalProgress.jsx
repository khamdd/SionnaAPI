export default function GlobalProgress({ active, label }) {
  return (
    <div
      className={`global-progress ${active ? "active" : ""}`}
      aria-hidden={!active}
      role="status"
    >
      <span>{label}</span>
      <div>
        <i />
      </div>
    </div>
  );
}
