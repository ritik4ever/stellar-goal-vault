export interface ShortcutConfig {
  key: string;
  label: string;
  description: string;
}

export const APP_SHORTCUTS: ShortcutConfig[] = [
  {
    key: '?',
    label: 'Help',
    description: 'Open/close keyboard shortcuts overlay',
  },
  {
    key: 'Esc',
    label: 'Close',
    description: 'Close any open modal or overlay',
  },
  {
    key: 'N',
    label: 'New Campaign',
    description: 'Focus the create campaign form',
  },
  {
    key: '/',
    label: 'Search',
    description: 'Focus search input',
  },
  {
    key: 'D',
    label: 'Dashboard',
    description: 'Go to dashboard',
  },
  {
    key: 'P',
    label: 'My Pledges',
    description: 'View my pledges',
  },
];
