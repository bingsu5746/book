import { createContext, useContext } from 'react';
import type { User } from './types';

export const SessionCtx = createContext<{ user: User; setUser: (u: User | null) => void }>({ user: { id: '', username: '', nickname: '' }, setUser: () => {} });
export const useSession = () => useContext(SessionCtx);
