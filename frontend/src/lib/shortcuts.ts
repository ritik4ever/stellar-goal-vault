export interface ShortcutConfig {
  key: string;
  label: string;
  description: string;
}

export const APP_SHORTCUTS: ShortcutConfig[] = [
  {
    key: "?",
    label: "Help",
    description: "Open/close keyboard shortcuts overlay",
  },
  {
    key: "Esc",
    label: "Close",
    description: "Close any open modal or overlay",
  },
  {
    key: "c",
    label: "Create",
    description: "Focus the create campaign form",
  },
  {
    key: "w",
    label: "Wallet",
    description: "Connect freighter wallet",
  },
  {
    key: "s",
    label: "Search",
    description: "Focus search input",
  },
];
