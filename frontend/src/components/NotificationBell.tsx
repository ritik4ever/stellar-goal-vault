import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellDot, CheckCheck, X } from 'lucide-react';
import type { NotificationItem } from '../types/campaign';
import { listNotifications, markAllNotificationsRead } from '../services/api';

interface NotificationBellProps {
  wallet: string | null;
  campaignId?: string | null;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function NotificationBell({ wallet, campaignId }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!wallet) return;
    try {
      const result = await listNotifications(wallet, { limit: 20 });
      setNotifications(result.data);
      setUnreadCount(result.unreadCount);
    } catch {
    }
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [wallet, fetchNotifications]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
  }, [open, fetchNotifications]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleMarkAllRead = async () => {
    if (!wallet) return;
    try {
      await markAllNotificationsRead(wallet);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
    }
  };

  const filtered = campaignId
    ? notifications.filter((n) => n.campaignId === campaignId)
    : notifications;

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        className="btn-ghost"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        style={{ position: 'relative', minHeight: 42, minWidth: 42, padding: 0 }}
      >
        {unreadCount > 0 ? <BellDot size={18} /> : <Bell size={18} />}
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-drawer">
          <div className="notification-drawer-header">
            <span className="notification-drawer-title">Notifications</span>
            {unreadCount > 0 && (
              <button
                className="notification-mark-read-btn"
                type="button"
                onClick={handleMarkAllRead}
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
            <button
              className="notification-close-btn"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="notification-drawer-body">
            {loading && notifications.length === 0 ? (
              <div className="notification-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="notification-empty">No notifications yet</div>
            ) : (
              filtered.map((n) => (
                <div
                  key={n.id}
                  className={`notification-item${n.isRead ? '' : ' notification-item-unread'}`}
                >
                  <div className="notification-item-title">
                    {n.type === 'new_pledge' && '💰 '}
                    {n.type === 'campaign_funded' && '🎉 '}
                    {n.type === 'refund_available' && '↩️ '}
                    {n.type === 'creator_update' && '📢 '}
                    {n.title}
                  </div>
                  <div className="notification-item-body">{n.body}</div>
                  <div className="notification-item-time">{timeAgo(n.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
