import { useCallback, useEffect, useState } from "react";

import { getCurrentUser } from "../api";
import {
  AUTH_TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from "../constants";

export default function useAuthSession() {
  const [currentUser, setCurrentUser] = useState(null);
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

    if (!token) {
      setStatus("unauthenticated");
      return;
    }

    getCurrentUser()
      .then((result) => {
        setCurrentUser(result.user);
        setStatus("authenticated");
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        setCurrentUser(null);
        setStatus("unauthenticated");
      });
  }, []);

  const authenticate = useCallback((authResult) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authResult.access_token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(authResult.user));
    setCurrentUser(authResult.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setCurrentUser(null);
    setStatus("unauthenticated");
  }, []);

  return {
    authenticate,
    currentUser,
    logout,
    status,
  };
}
