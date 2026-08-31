import { useTranslation } from 'react-i18next';

export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  return (
    <div
      className="language-selector"
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        color: 'var(--text-secondary)',
      }}
    >
      <span>{t('app.footer.language')}:</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        style={{
          background: 'var(--surface-color)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          padding: '4px 8px',
        }}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="pt">Português</option>
      </select>
    </div>
  );
}
