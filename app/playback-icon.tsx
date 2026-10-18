export function PlaybackIcon({
  name,
}: {
  name: "play" | "pause" | "back" | "forward";
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="currentColor"
      aria-hidden="true"
    >
      {name === "play" ? (
        <path d="M8 4.6c0-1.3 1.5-2 2.6-1.3L28 14.6a1.7 1.7 0 0 1 0 2.8L10.6 28.7C9.5 29.4 8 28.7 8 27.4Z" />
      ) : name === "pause" ? (
        <>
          <rect x="7" y="4" width="6" height="24" rx="1.5" />
          <rect x="19" y="4" width="6" height="24" rx="1.5" />
        </>
      ) : (
        <g
          transform={
            name === "back" ? "translate(32 0) scale(-1 1)" : undefined
          }
        >
          <path d="M2 7c0-1.3 1.3-2 2.4-1.3L16 14V7c0-1.3 1.3-2 2.4-1.3L30 14.6a1.7 1.7 0 0 1 0 2.8l-11.6 8.9C17.3 27 16 26.3 16 25v-7L4.4 26.3C3.3 27 2 26.3 2 25Z" />
        </g>
      )}
    </svg>
  );
}
