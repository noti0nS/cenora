type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/**
 * A torii gate, drawn on Lucide's 24px grid so it sits next to the library
 * icons (same stroke width, round caps and joins).
 */
export function ToriiIcon({ size = 24, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 3.7C6 5.9 18 5.9 22 3.7" />
      <path d="M4.4 9.4h15.2" />
      <path d="M7.1 5V20.3" />
      <path d="M16.9 5V20.3" />
      <path d="M12 5.05v4.35" />
    </svg>
  );
}
