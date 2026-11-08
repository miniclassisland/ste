"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { accounts } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AccountOut } from "@/lib/types";

interface AccountContextType {
  accountList: AccountOut[];
  accountId: string;
  currentAccount: (AccountOut & { server_url?: string }) | null;
  setAccountId: (id: string) => void;
  reloadAccounts: () => Promise<AccountOut[]>;
  loading: boolean;
}

const AccountContext = createContext<AccountContextType>({
  accountList: [],
  accountId: "default",
  currentAccount: null,
  setAccountId: () => {},
  reloadAccounts: async () => [],
  loading: false,
});

export function AccountProvider({
  children,
  initialAccount = null,
}: {
  children: React.ReactNode;
  initialAccount?: (AccountOut & { server_url?: string }) | null;
}) {
  const { isAuthenticated } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<
    (AccountOut & { server_url?: string }) | null
  >(initialAccount);
  const [loading, setLoading] = useState(false);

  const reloadAccounts = useCallback(async (): Promise<AccountOut[]> => {
    if (!isAuthenticated) {
      setCurrentAccount(null);
      return [];
    }
    setLoading(true);
    try {
      const acct = await accounts.get("default");
      setCurrentAccount(acct);
      setLoading(false);
      return [acct];
    } catch {
      setLoading(false);
      return [];
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && !currentAccount) {
      reloadAccounts();
    } else if (!isAuthenticated) {
      setCurrentAccount(null);
    }
  }, [isAuthenticated, currentAccount, reloadAccounts]);

  const accountList = currentAccount ? [currentAccount] : [];

  return (
    <AccountContext.Provider
      value={{
        accountList,
        accountId: "default",
        currentAccount,
        setAccountId: () => {},
        reloadAccounts,
        loading,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
