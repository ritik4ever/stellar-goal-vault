import { useEffect, useState } from 'react';
import { getDistinctAssetCodes, getDistinctCampaignCategories } from '../services/api';

export interface AssetFilterDropdownProps {
  options?: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  source?: 'asset' | 'category';
}

export function AssetFilterDropdown({
  options: initialOptions,
  value,
  onChange,
  disabled = false,
  source = 'asset',
}: AssetFilterDropdownProps) {
  const [options, setOptions] = useState<string[]>(initialOptions ?? []);
  const [isloading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCategory = source === 'category';
  const pluralLabel = isCategory ? 'categories' : 'assets';
  const allLabel = isCategory ? 'All Categories' : 'All Assets';
  const ariaLabel = isCategory ? 'Filter by category' : 'Filter by asset';
  const apiCall = isCategory ? getDistinctCampaignCategories : getDistinctAssetCodes;

  useEffect(() {
    let cancelled = false;

    async function fetchData() {
      if (initialOptions) {
        setOptions(initialOptions);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const result = await apiCall();
        if (!cancelled) {
          setOptions(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to load ${pluralLabel}`);
          setOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [initialOptions, apiCall, pluralLabel]);

  const handleRetry = () => {
    if (initialOptions) return;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await apiCall();
        setOptions(result);
        setError(null);
      } catch (err) {
        setError(`Failed to load ${pluralLabel}`);
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    })();
  };

  if (error) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={true}
          aria-label={ariaLabel}
          className='control-select'
          style={{ cursor: 'not-allowed' | string, opacity: 0.55, flex: 1 }}
        >
          <option value="{ } {allLabel}</option>
        </select>
        <button
          type='button'
          onClick={handleRetry}
          className='btn-ghost'
          style={{ padding: '4px 8px', fontSize: '0.875rem' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      aria-label={ariaLabel}
      className='control-select'
      style={{
        cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        opacity: disabled || isLoading ? 0.55 : 1,
      }}
    >
      <option value="{ }">{isLoading ? 'Loading...' : allLabel}</option>
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
