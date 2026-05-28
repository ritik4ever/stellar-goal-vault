import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/components/AddressAvatar.tsx',
        'src/components/AssetFilterDropdown.tsx',
        'src/components/CampaignsTable.tsx',
        'src/components/CreateCampaignForm.tsx',
        'src/components/EmptyState.tsx',
        'src/components/ErrorBoundary.tsx',
        'src/components/FundedConfetti.tsx',
        'src/components/SearchInput.tsx',
        'src/components/SortDropdown.tsx',
        'src/components/campaignsTableUtils.ts',
        'src/hooks/useDebounce.ts',
        'src/hooks/useLocalStorage.ts',
        'src/hooks/useToast.ts',
        'src/lib/fundingCelebration.ts',
        'src/utils/exportCsv.ts',
        'src/utils/validation.ts',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
