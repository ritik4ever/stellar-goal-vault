import { useMemo } from "react";

interface AddressAvatarProps {
  address: string;
  size?: number;
  className?: string;
}

const COLORS = [
  "hsl(225, 85%, 65%)", // Indigo
  "hsl(270, 80%, 70%)", // Purple
  "hsl(330, 75%, 65%)", // Pink
  "hsl(15, 80%, 60%)",  // Orange
  "hsl(160, 70%, 45%)", // Teal
  "hsl(190, 80%, 50%)", // Sky
  "hsl(45, 90%, 55%)",  // Amber
  "hsl(20, 85%, 55%)",  // Coral
];

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
}

export function AddressAvatar({ address, size = 32, className = "" }: AddressAvatarProps) {
  const initials = useMemo(() => {
    if (!address || address.length < 3) return "??";
    // Skip the 'G' and take next two characters for better variety
    return address.slice(1, 3).toUpperCase();
  }, [address]);

  const backgroundColor = useMemo(() => stringToColor(address), [address]);

  return (
    <div
      className={`address-avatar ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor,
        fontSize: size * 0.4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        color: "white",
        fontWeight: "bold",
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
        textShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
      }}
      title={address}
    >
      {initials}
    </div>
  );
}

export default AddressAvatar;
