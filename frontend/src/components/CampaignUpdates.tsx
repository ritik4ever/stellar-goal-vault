import { useState, FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { AddressAvatar } from './AddressAvatar';
import { CampaignUpdate } from '../types/campaign';

interface CampaignUpdatesProps {
  campaignId: string;
  creator: string;
  updates: CampaignUpdate[];
  connectedWallet?: string | null;
  onPostUpdate?: (content: string) => Promise<void>;
  isLoading?: boolean;
}

const MAX_CONTENT_LENGTH = 2000;
const UPDATES_PER_PAGE = 10;

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function sanitizeMarkdown(markdown: string): string {
  const html = DOMPurify.sanitize(markdown, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false,
  });
  return html;
}

export function CampaignUpdates({
  campaignId,
  creator,
  updates = [],
  connectedWallet = null,
  onPostUpdate = async () => {},
  isLoading = false,
}: CampaignUpdatesProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const isCreator = connectedWallet === creator;
  const totalPages = Math.ceil(updates.length / UPDATES_PER_PAGE);
  const paginatedUpdates = updates
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice((currentPage - 1) * UPDATES_PER_PAGE, currentPage * UPDATES_PER_PAGE);

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const canSubmit = content.trim().length > 0 && !isOverLimit && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onPostUpdate(content.trim());
      setContent('');
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post update');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card campaign-updates">
      <div className="section-heading">
        <h2>Campaign Updates</h2>
        <span className="muted">{updates.length} update{updates.length !== 1 ? 's' : ''}</span>
      </div>

      {isCreator && (
        <form className="update-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>Post an update</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Share progress, news, or updates with your backers... (Markdown supported)"
              rows={4}
              maxLength={MAX_CONTENT_LENGTH + 1}
              disabled={isSubmitting}
              aria-invalid={isOverLimit}
              aria-describedby={isOverLimit ? 'char-error' : 'char-count'}
            />
            <div className="char-counter">
              <span 
                id="char-count"
                className={isOverLimit ? 'over-limit' : ''}
              >
                {charCount}/{MAX_CONTENT_LENGTH}
              </span>
              {isOverLimit && (
                <span id="char-error" className="error-text">
                  {' '}Character limit exceeded
                </span>
              )}
            </div>
          </label>
          <button
            className="btn-primary"
            type="submit"
            disabled={!canSubmit}
          >
            {isSubmitting ? 'Posting...' : 'Post Update'}
          </button>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
        </form>
      )}

      {isLoading && updates.length === 0 ? (
        <div className="updates-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="update-skeleton">
              <div className="skeleton skeleton-avatar" />
              <div className="skeleton-content">
                <div className="skeleton skeleton-line" style={{ width: 120 }} />
                <div className="skeleton skeleton-line" style={{ width: '100%', marginTop: 8 }} />
                <div className="skeleton skeleton-line" style={{ width: '80%', marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      ) : updates.length === 0 ? (
        <div className="empty-updates">
          <p className="muted">No updates yet. {isCreator ? 'Be the first to share progress!' : 'Check back later for updates from the creator.'}</p>
        </div>
      ) : (
        <>
          <div className="updates-list">
            {paginatedUpdates.map((update) => (
              <article key={update.id} className="update-item">
                <div className="update-header">
                  <AddressAvatar address={update.creator} size={32} />
                  <div className="update-meta">
                    <strong className="mono">{update.creator.slice(0, 16)}...</strong>
                    <span className="timestamp">{formatTimestamp(update.createdAt)}</span>
                  </div>
                </div>
                <div className="update-content">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p>{children}</p>,
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      code: ({ inline, children }) => 
                        inline ? (
                          <code>{children}</code>
                        ) : (
                          <pre><code>{children}</code></pre>
                        )
                    }}
                  >
                    {sanitizeMarkdown(update.content)}
                  </ReactMarkdown>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn-ghost"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                Previous
              </button>
              <span className="page-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn-ghost"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CampaignUpdates;
