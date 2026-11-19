import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (title: string, options?: { description?: string; variant?: ToastVariant }) => void;
  browserAlertsEnabled: boolean;
  toggleBrowserAlerts: () => Promise<void>;
  notifyBrowser: (title: string, body: string) => void;
}

const ALERTS_STORAGE_KEY = 'ch_browser_alerts';

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  browserAlertsEnabled: false,
  toggleBrowserAlerts: async () => {},
  notifyBrowser: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(ALERTS_STORAGE_KEY) === 'true';
    if (saved && 'Notification' in window && Notification.permission === 'granted') {
      setBrowserAlertsEnabled(true);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (title: string, options?: { description?: string; variant?: ToastVariant }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItem = {
        id,
        title,
        description: options?.description,
        variant: options?.variant || 'info',
      };
      setToasts((prev) => [...prev.slice(-3), item]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const toggleBrowserAlerts = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast('Desktop alerts unavailable', {
        description: 'This browser does not support desktop notifications.',
        variant: 'error',
      });
      return;
    }

    if (browserAlertsEnabled) {
      setBrowserAlertsEnabled(false);
      window.localStorage.setItem(ALERTS_STORAGE_KEY, 'false');
      toast('Desktop alerts disabled', { variant: 'info' });
      return;
    }

    if (Notification.permission === 'granted') {
      setBrowserAlertsEnabled(true);
      window.localStorage.setItem(ALERTS_STORAGE_KEY, 'true');
      toast('Desktop alerts enabled', {
        description: 'You will be notified when tasks finish.',
        variant: 'success',
      });
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setBrowserAlertsEnabled(true);
      window.localStorage.setItem(ALERTS_STORAGE_KEY, 'true');
      toast('Desktop alerts enabled', {
        description: 'You will be notified when tasks finish.',
        variant: 'success',
      });
    } else {
      toast('Notification permission denied', {
        description: 'Allow notifications in your browser settings to enable alerts.',
        variant: 'error',
      });
    }
  }, [browserAlertsEnabled, toast]);

  const notifyBrowser = useCallback(
    (title: string, body: string) => {
      if (
        !browserAlertsEnabled ||
        typeof window === 'undefined' ||
        !('Notification' in window) ||
        Notification.permission !== 'granted'
      ) {
        return;
      }
      try {
        new Notification(title, { body, icon: '/favicon.svg' });
      } catch {
        // Ignore notification errors in restricted environments
      }
    },
    [browserAlertsEnabled],
  );

  return (
    <ToastContext.Provider
      value={{ toast, browserAlertsEnabled, toggleBrowserAlerts, notifyBrowser }}
    >
      {children}

      {/* Toast Stack */}
      <div
        className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto rounded-xl border border-white/[0.1] bg-[#111216]/95 backdrop-blur-md px-3.5 py-3 shadow-2xl shadow-black/60 flex items-start gap-2.5 animate-enter"
          >
            {item.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : item.variant === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-zinc-100">{item.title}</p>
              {item.description && (
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-zinc-500 hover:text-zinc-200 transition-colors p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
