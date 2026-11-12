import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';

export interface Pricing { initialCredits: number; downloadCost: number; runBase: number; runPerSecond: number; minToRun: number }
interface CreditsState { balance: number | null; pricing: Pricing | null; refresh: () => Promise<void> }

const Ctx = createContext<CreditsState>({ balance: null, pricing: null, refresh: async () => {} });
export const useCredits = () => useContext(Ctx);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ balance: number; pricing: Pricing }>('/credits/balance');
      setBalance(r.balance);
      setPricing(r.pricing);
    } catch { /* keep the last known balance */ }
  }, []);

  useEffect(() => {
    if (user) refresh(); else setBalance(null);
  }, [user, refresh]);

  return <Ctx.Provider value={{ balance, pricing, refresh }}>{children}</Ctx.Provider>;
}

/** Shown only when the balance is below `need`. */
export function CreditWarning({ need, action }: { need: number; action: string }) {
  const { balance } = useCredits();
  if (balance === null || balance >= need) return null;
  return (
    <div className="warn" role="alert">
      <span className="warn-icon" aria-hidden>⚠</span>
      <div>
        <strong>You're low on credits</strong>
        <div>
          You have {balance} credit{balance === 1 ? '' : 's'}, and {action} needs at least {need}.
        </div>
      </div>
      <Link to="/credits" className="btn">Get more credits</Link>
    </div>
  );
}
