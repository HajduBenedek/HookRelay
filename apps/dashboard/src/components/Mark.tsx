/** HookRelay's mark: a webhook coming in on the left and handed back on, in the accent. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M6 8h7.5a3.5 3.5 0 0 1 0 7H10"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m12 12.5-2.5 2.5 2.5 2.5"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="8" r="1.6" fill="var(--surface)" />
    </svg>
  );
}
