import { useEffect, useState } from 'react';
import { getDistinctAssetCodes } from '../services/api';

export interface AssetFilterDropdownProps {
  options?: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AssetFilterDropdown({
  options: initialOptions,
  value,
  onChange,
  disabled = false,
}: AssetFilterDropdownProps) {
  const [options, setOptions] = useState<string[]>(initialOptions ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAssets() {
      if (initialOptions) {
        setOptions(initialOptions);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const assets = await getDistinctAssetCodes();
        if (!cancelled) {
          setOptions(assets);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load assets');
          setOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchAssets();
    return () => {
      cancelled = true;
    };
  }, [initialOptions]);

  const handleRetry = () => {
    if (initialOptions) return;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const assets = await getDistinctAssetCodes();
        setOptions(assets);
        setError(null);
      } catch (err) {
        setError('Failed to load assets');
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
          aria-label="Filter by asset"
          className="control-select"
          style={{ cursor: 'not-allowed', opacity: 0.55, flex: 1 }}
        >
          <option value="">All Assets</option>
        </select>
        <button
          type="button"
          onClick={handleRetry}
          className="btn-ghost"
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
      aria-label="Filter by asset"
      className="control-select"
      style={{ cursor: disabled || isLoading ? 'not-allowed' : 'pointer', opacity: disabled || isLoading ? 0.55 : 1 }}
    >
      <option value="">{isLoading ? 'Loading...' : 'All Assets'}</option>
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
