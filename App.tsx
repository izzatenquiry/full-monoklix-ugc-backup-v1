import React, { useState, useEffect, useCallback, useRef } from 'react';
// FIX: Import Language type for state management.
import { type View, type User, type BatchProcessorPreset, type Language, UserStatus } from './types';
// FIX: Add missing UsersIcon to imports.
import { LogoIcon, XIcon, SunIcon, MoonIcon, CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon, ServerIcon, ShieldCheckIcon, TerminalIcon, SparklesIcon, ChevronRightIcon, AppleIcon, UsersIcon } from './components/Icons';
// FIX: Moved getAvailableServersForUser to userService.ts to fix circular dependency and added it to imports here.
import { signOutUser, logActivity, getVeoAuthTokens, getSharedMasterApiKey, updateUserLastSeen, assignPersonalTokenAndIncrementUsage, saveUserPersonalAuthToken, getServerUsageCounts, updateUserProxyServer, updateTokenStatusToExpired, getAvailableServersForUser } from './services/userService';
import Spinner from './components/common/Spinner';
import { loadData, saveData } from './services/indexedDBService';
import { supabase, type Database } from './services/supabaseClient';
import { runComprehensiveTokenTest } from './services/imagenV3Service';
import ConsoleLogSidebar from './components/ConsoleLogSidebar';
import { getTranslations } from './services/translations';
import ApiKeyStatus from './components/ApiKeyStatus';
import eventBus from './services/eventBus';
import LoginPage from './LoginPage';
import WelcomeAnimation from './components/WelcomeAnimation';
import UgcGeneratorView from './components/views/UgcGeneratorView';


interface Message {
  role: 'user' | 'model';
  text: string;
}

const ThemeSwitcher: React.FC<{ theme: string; setTheme: (theme: string) => void }> = ({ theme, setTheme }) => {
    // FIX: Correctly access translations via `common` key.
    const T = getTranslations().common;
    return (
    <button
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        aria-label={T.switchTheme}
    >
        {theme === 'light' ? (
            <MoonIcon className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
        ) : (
            <SunIcon className="w-5 h-5 text-yellow-500" />
        )}
    </button>
)};

const NotificationBanner: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => {
    // FIX: Correctly access translations via `common` key.
    const T = getTranslations().common;
    return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 w-full max-w-md z-50 p-4">
        <div className="bg-yellow-100 dark:bg-yellow-900/50 border-l-4 border-yellow-500 text-yellow-800 dark:text-yellow-200 p-4 rounded-r-lg shadow-lg flex items-start gap-3 animate-zoomIn">
            <AlertTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="font-bold">{T.attention}</p>
                <p className="text-sm">{message}</p>
            </div>
            <button onClick={onDismiss} className="p-1 rounded-full hover:bg-yellow-200 dark:hover:bg-yellow-800">
                <XIcon className="w-4 h-4" />
            </button>
        </div>
    </div>
)};

type AssigningStatus = 'scanning' | 'assigning' | 'success' | 'error';
interface AssigningTokenModalProps {
  status: AssigningStatus;
  error: string | null;
  scanProgress: { current: number; total: number };
  onRetry: () => void;
}

const AssigningTokenModal: React.FC<AssigningTokenModalProps> = ({ status, error, scanProgress, onRetry }) => {
    // FIX: Correctly access translations via `assigningTokenModal` key.
    const T = getTranslations().assigningTokenModal;
    
    const statusInfo = {
        scanning: {
            icon: <Spinner />,
            title: T.scanningTitle,
            message: scanProgress.total > 0
                ? T.scanningMessage.replace('{current}', String(scanProgress.current)).replace('{total}', String(scanProgress.total))
                : T.scanningMessageDefault,
        },
        assigning: {
            icon: <Spinner />,
            title: T.assigningTitle,
            message: T.assigningMessage,
        },
        success: {
            icon: <ShieldCheckIcon className="w-12 h-12 text-green-500 mx-auto" />,
            title: T.successTitle,
            message: T.successMessage,
        },
        error: {
            icon: <AlertTriangleIcon className="w-12 h-12 text-red-500 mx-auto" />,
            title: T.errorTitle,
            message: error || T.errorMessageDefault,
        },
    };

    const currentStatusInfo = statusInfo[status];

    return (
        <div className="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-50 p-4 animate-zoomIn" aria-modal="true" role="dialog">
            <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl p-8 text-center max-w-sm w-full">
                {currentStatusInfo.icon}
                <h2 className="text-xl font-bold mt-4 text-neutral-800 dark:text-neutral-100">{currentStatusInfo.title}</h2>
                <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm">
                    {currentStatusInfo.message}
                </p>
                {status === 'error' && (
                    <button onClick={onRetry} className="mt-6 w-full bg-primary-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-primary-700 transition-colors">
                        {T.retryButton}
                    </button>
                )}
            </div>
        </div>
    );
};

interface ServerSelectionModalProps {
  isOpen: boolean;
  servers: string[];
  serverUsage: Record<string, number>;
  onSelect: (serverUrl: string) => void;
}

const ServerSelectionModal: React.FC<ServerSelectionModalProps> = ({ isOpen, servers, serverUsage, onSelect }) => {
    const T = getTranslations().serverSelectionModal;

    const getUsageColor = (count: number) => {
        if (count < 10) return 'text-green-500';
        if (count < 20) return 'text-yellow-500';
        return 'text-red-500';
    };

    const handleAutoSelect = () => {
        if (servers.length === 0) return;

        // Find the server with the minimum usage
        const leastBusyServer = servers.reduce((leastBusy, currentServer) => {
            const leastBusyUsage = serverUsage[leastBusy] || 0;
            const currentUsage = serverUsage[currentServer] || 0;
            return currentUsage < leastBusyUsage ? currentServer : leastBusy;
        }, servers[0]);

        onSelect(leastBusyServer);
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center p-4 z-50 animate-zoomIn">
            <div className="w-full max-w-md text-center">
                <h1 className="text-3xl font-bold mb-2">{T.title}</h1>
                <p className="text-neutral-500 dark:text-neutral-400 mb-8">{T.subtitle}</p>

                <div className="flex flex-col gap-3">
                    {servers.map(serverUrl => {
                        const usage = serverUsage[serverUrl] || 0;
                        const serverName = serverUrl.replace('https://', '').replace('.monoklix.com', '');
                        const isAppleFriendly = serverName === 's1' || serverName === 's6';
                        return (
                            <button
                                key={serverUrl}
                                onClick={() => onSelect(serverUrl)}
                                className="w-full flex items-center p-4 bg-white dark:bg-neutral-800 rounded-lg shadow-md border border-transparent hover:border-primary-500 hover:shadow-lg transition-all group"
                            >
                                <ServerIcon className="w-8 h-8 text-primary-500" />
                                <div className="flex-1 ml-4 text-left flex items-center gap-2">
                                    <p className="font-bold text-lg capitalize">{T.server} {serverName.toUpperCase()}</p>
                                    {isAppleFriendly && <AppleIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" title="Optimized for Apple devices" />}
                                </div>
                                <div className={`flex items-center justify-center gap-2 text-sm font-semibold mr-2 ${getUsageColor(usage)}`}>
                                    <UsersIcon className="w-4 h-4" />
                                    <span>{usage} Users</span>
                                </div>
                                <ChevronRightIcon className="w-6 h-6 text-neutral-400 group-hover:text-primary-500 transition-colors" />
                            </button>
                        );
                    })}

                    {/* Auto Select Button */}
                    <button
                        onClick={handleAutoSelect}
                        className="w-full flex items-center p-4 mt-4 bg-primary-600 text-white rounded-lg shadow-lg hover:bg-primary-700 transition-all group"
                    >
                        <SparklesIcon className="w-8 h-8" />
                        <div className="flex-1 ml-4 text-left">
                            <p className="font-bold text-lg">Auto Select</p>
                            <p className="text-sm opacity-80">Connect to the fastest server</p>
                        </div>
                        <ChevronRightIcon className="w-6 h-6 text-white/70 group-hover:text-white transition-colors" />
                    </button>
                </div>
            </div>
        </div>
    );
};


const App: React.FC = () => {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeApiKey, setActiveApiKey] = useState<string | null>(null);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true);
  const [theme, setTheme] = useState('light'); // Default to light, load async
  const [language, setLanguage] = useState<Language>('en');
  const [isLogSidebarOpen, setIsLogSidebarOpen] = useState(false);
  const [isShowingWelcome, setIsShowingWelcome] = useState(false);
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [needsTokenAssignment, setNeedsTokenAssignment] = useState(false);
  const [veoTokenRefreshedAt, setVeoTokenRefreshedAt] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const isAssigningTokenRef = useRef(false);
  const [assigningStatus, setAssigningStatus] = useState<AssigningStatus>('scanning');
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [autoAssignError, setAutoAssignError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [needsSilentTokenAssignment, setNeedsSilentTokenAssignment] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverOptions, setServerOptions] = useState<{ servers: string[], usage: Record<string, number> }>({ servers: [], usage: {} });
  const [serverModalPurpose, setServerModalPurpose] = useState<'login' | 'change'>('login');
  
  const T = getTranslations().app;

  const handleUserUpdate = useCallback((updatedUser: User) => {
    setCurrentUser(updatedUser);
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));
  }, []);

  const handleLogout = useCallback(async () => {
    if (currentUser) {
      updateUserProxyServer(currentUser.id, null);
    }
    await signOutUser();
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('monoklix_session_api_key');
    sessionStorage.removeItem('session_started_at');
    sessionStorage.removeItem('selectedProxyServer');
    setCurrentUser(null);
    setActiveApiKey(null);
  }, [currentUser]);

  const handleClearCacheAndRefresh = () => {
    if (window.confirm(T.clearCacheConfirm)) {
        try {
            console.log("Clearing session and refreshing app...");
            sessionStorage.clear();
            localStorage.clear();
            window.location.reload();
        } catch (error) {
            console.error("Failed to refresh session:", error);
            alert(T.clearCacheError);
        }
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
        const savedTheme = await loadData<string>('theme');
        if (savedTheme) setTheme(savedTheme);
        const savedLang = await loadData<Language>('language');
        if (savedLang) setLanguage(savedLang);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveData('theme', theme);
  }, [theme]);
  
  useEffect(() => {
    saveData('language', language);
  }, [language]);
  
  useEffect(() => {
    const handleUserUsageUpdate = (updatedUser: User) => {
      console.log('App: User usage stats updated via event bus. Refreshing state.');
      handleUserUpdate(updatedUser);
    };

    eventBus.on('userUsageUpdated', handleUserUsageUpdate);

    return () => {
      eventBus.remove('userUsageUpdated', handleUserUsageUpdate);
    };
  }, [handleUserUpdate]);
  
  useEffect(() => {
    try {
        const savedUserJson = localStorage.getItem('currentUser');
        if (savedUserJson) {
            const user = JSON.parse(savedUserJson);
            setCurrentUser(user);
            sessionStorage.setItem('session_started_at', new Date().toISOString());
        }
    } catch (error) {
        console.error("Failed to parse user from localStorage", error);
        localStorage.removeItem('currentUser');
    }
    setSessionChecked(true);
  }, []);

  const assignTokenProcess = useCallback(async (): Promise<{ success: boolean; error: string | null; }> => {
        if (!currentUser || isAssigningTokenRef.current) {
            return { success: false, error: "Process is already running or user is not available." };
        }
        
        isAssigningTokenRef.current = true;
        setAssigningStatus('scanning');
        
        console.log('Starting auto-assignment process...');

        const tokensJSON = sessionStorage.getItem('veoAuthTokens');
        if (!tokensJSON) {
            const errorMsg = "System could not find any available connection tokens. Please contact the admin.";
            isAssigningTokenRef.current = false;
            setAssigningStatus('error');
            return { success: false, error: errorMsg };
        }
        
        let tokenAssigned = false;
        let finalError: string | null = "All connection slots are currently full. Please try again in a moment or contact the admin.";

        try {
            const sharedTokens: { token: string; createdAt: string }[] = JSON.parse(tokensJSON);
            setScanProgress({ current: 0, total: sharedTokens.length });
            
            for (let i = sharedTokens.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sharedTokens[i], sharedTokens[j]] = [sharedTokens[j], sharedTokens[i]];
            }

            for (const [index, tokenData] of sharedTokens.entries()) {
                setScanProgress({ current: index + 1, total: sharedTokens.length });
                console.log(`[Auto-Assign] Testing shared token... ${tokenData.token.slice(-6)}`);
                const results = await runComprehensiveTokenTest(tokenData.token);
                const isImagenOk = results.find(r => r.service === 'Imagen')?.success;
                const isVeoOk = results.find(r => r.service === 'Veo')?.success;

                if (isImagenOk && isVeoOk) {
                    console.log(`[Auto-Assign] Found valid token: ...${tokenData.token.slice(-6)}. Assigning to user.`);
                    setAssigningStatus('assigning');
                    const assignResult = await assignPersonalTokenAndIncrementUsage(currentUser.id, tokenData.token);

                    if (assignResult.success === false) {
                        console.warn(`[Auto-Assign] Could not assign token ...${tokenData.token.slice(-6)}: ${assignResult.message}. Trying next.`);
                        setAssigningStatus('scanning'); 
                        if (assignResult.message === 'DB_SCHEMA_MISSING_COLUMN_personal_auth_token' && currentUser.role === 'admin') {
                            finalError = "Database schema is outdated.";
                            alert("Database schema is outdated.\n\nPlease go to your Supabase dashboard and run the following SQL command to add the required column:\n\nALTER TABLE public.users ADD COLUMN personal_auth_token TEXT;");
                            break;
                        }
                    } else {
                        handleUserUpdate(assignResult.user);
                        console.log('[Auto-Assign] Successfully assigned personal token.');
                        tokenAssigned = true;
                        finalError = null;
                        setAssigningStatus('success');
                        break;
                    }
                } else {
                    console.warn(`[Auto-Assign] Token ...${tokenData.token.slice(-6)} failed health check. Skipping token.`);
                }
            }

            if (!tokenAssigned) {
                console.log('[Auto-Assign] No valid shared tokens found after testing all available ones.');
            }

        } catch (error) {
            console.error('[Auto-Assign] An error occurred during the token assignment process:', error);
            finalError = "An unexpected error occurred during assignment. Please try again.";
        } finally {
            isAssigningTokenRef.current = false;
        }
        
        if (!tokenAssigned) {
            setAssigningStatus('error');
        }

        return { success: tokenAssigned, error: finalError };
    }, [currentUser, handleUserUpdate]);

    const handlePersonalTokenFailure = useCallback(async () => {
        if (isAssigningTokenRef.current || !currentUser || !currentUser.personalAuthToken) {
            return;
        }

        console.warn('[Token Fallback] Personal token failed. Initiating silent auto-fallback process.');

        const clearResult = await saveUserPersonalAuthToken(currentUser.id, null);
        
        if (clearResult.success === false) {
            console.error("[Token Fallback] Failed to clear the invalid token.", clearResult.message);
        } else {
            handleUserUpdate(clearResult.user);
            setNeedsSilentTokenAssignment(true);
        }
    }, [currentUser, handleUserUpdate]);

    useEffect(() => {
        if (!needsSilentTokenAssignment || !currentUser) return;
        
        const runSilentAssignment = async () => {
            console.log('[Token Fallback] Running silent token assignment process in background.');
            const result = await assignTokenProcess();
            if (result.success) {
                console.log('[Token Fallback] Silently assigned new token successfully.');
            } else {
                console.error('[Token Fallback] Silent token assignment failed:', result.error);
            }
            setNeedsSilentTokenAssignment(false); 
        }
        
        runSilentAssignment();

    }, [needsSilentTokenAssignment, currentUser, assignTokenProcess]);


    useEffect(() => {
        eventBus.on('personalTokenFailed', handlePersonalTokenFailure);
        return () => {
            eventBus.remove('personalTokenFailed', handlePersonalTokenFailure);
        };
    }, [handlePersonalTokenFailure]);

  const initializeSessionData = useCallback(async (userId: string) => {
    if (!userId) return;
    
    setIsApiKeyLoading(true);
    try {
      const [masterKey, tokensData] = await Promise.all([
        getSharedMasterApiKey(),
        getVeoAuthTokens(),
      ]);

      if (masterKey) {
        sessionStorage.setItem('monoklix_session_api_key', masterKey);
        setActiveApiKey(masterKey);
        console.log(`[Session] Shared master API key (...${masterKey.slice(-4)}) loaded.`);
      } else {
        console.error("CRITICAL: Could not fetch master API key from Supabase.");
        setActiveApiKey(null);
      }

      if (tokensData && tokensData.length > 0) {
        sessionStorage.setItem('veoAuthTokens', JSON.stringify(tokensData));
        sessionStorage.setItem('veoAuthToken', tokensData[0].token);
        sessionStorage.setItem('veoAuthTokenCreatedAt', tokensData[0].createdAt);
        setVeoTokenRefreshedAt(new Date().toISOString());
        console.log(`[Session] ${tokensData.length} VEO Auth Tokens loaded.`);
      } else {
        sessionStorage.removeItem('veoAuthTokens');
        sessionStorage.removeItem('veoAuthToken');
        sessionStorage.removeItem('veoAuthTokenCreatedAt');
        console.warn("[Session] Could not fetch any VEO Auth Tokens from Supabase.");
      }
    } catch (error) {
      console.error("[Session] Error initializing session data (API key & VEO tokens):", error);
      setActiveApiKey(null);
    } finally {
      setIsApiKeyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      initializeSessionData(currentUser.id);
    } else {
      setActiveApiKey(null);
      sessionStorage.removeItem('monoklix_session_api_key');
      sessionStorage.removeItem('veoAuthTokens');
      sessionStorage.removeItem('veoAuthToken');
      sessionStorage.removeItem('veoAuthTokenCreatedAt');
      setIsApiKeyLoading(false);
    }
  }, [currentUser?.id, initializeSessionData]);


  useEffect(() => {
    if (justLoggedIn) {
        setIsShowingWelcome(true);
        setJustLoggedIn(false); 
    }
  }, [justLoggedIn]);
  
    useEffect(() => {
        if (currentUser?.id) {
            updateUserLastSeen(currentUser.id);
            const heartbeatInterval = setInterval(() => {
                updateUserLastSeen(currentUser!.id);
            }, 30000);
            return () => clearInterval(heartbeatInterval);
        }
    }, [currentUser?.id]);

    useEffect(() => {
        if (!currentUser?.id) return;

        const channel = supabase
            .channel(`user-session-channel-${currentUser.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'users',
                    filter: `id=eq.${currentUser.id}`,
                },
                (payload) => {
                    const newUserData = payload.new as Database['public']['Tables']['users']['Row'];
                    const forceLogoutAt = newUserData.force_logout_at;
                    
                    if (forceLogoutAt) {
                        const sessionStartedAt = sessionStorage.getItem('session_started_at');
                        if (sessionStartedAt && new Date(forceLogoutAt) > new Date(sessionStartedAt)) {
                            alert(T.sessionTerminated);
                            handleLogout();
                        }
                    }
                }
            )
            .subscribe();
        
        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUser?.id, handleLogout, T.sessionTerminated]);
    
    const retryAssignment = useCallback(async () => {
        setAssigningStatus('scanning');
        setAutoAssignError(null);
        setScanProgress({ current: 0, total: 0 });
        const result = await assignTokenProcess();
        if (result.success) {
            setTimeout(() => {
                setShowAssignModal(false);
                setJustLoggedIn(true);
            }, 1500);
        } else if (result.error) {
            setAutoAssignError(result.error);
        }
    }, [assignTokenProcess]);

    useEffect(() => {
        if (!needsTokenAssignment || !currentUser) return;

        const runAssignment = async () => {
            setShowAssignModal(true);
            setAssigningStatus('scanning');
            setAutoAssignError(null);
            setScanProgress({ current: 0, total: 0 });

            const result = await assignTokenProcess();

            if (result.success) {
                setTimeout(() => {
                    setShowAssignModal(false);
                    if (justLoggedIn) {
                        setJustLoggedIn(true);
                    }
                }, 1500);
            } else {
                setAutoAssignError(result.error);
                setAssigningStatus('error');
            }
            setNeedsTokenAssignment(false);
        };

        runAssignment();
    }, [needsTokenAssignment, currentUser, assignTokenProcess, justLoggedIn]);
  
  const proceedWithPostLoginFlow = (user: User) => {
    if (user && !user.personalAuthToken) {
        setNeedsTokenAssignment(true);
    } else {
        setJustLoggedIn(true);
    }
  };
    
    useEffect(() => {
        const autoSelectServerIfNeeded = async () => {
            const serverInSession = sessionStorage.getItem('selectedProxyServer');
            const sessionStartTime = sessionStorage.getItem('session_started_at');
            const isRecentSessionStart = sessionStartTime && (new Date().getTime() - new Date(sessionStartTime).getTime()) < 3000;

            if (currentUser && !serverInSession && !isRecentSessionStart && window.location.hostname !== 'localhost') {
                console.log("[Auto-Select Server] No server found in session. Attempting to auto-connect to the least busy server.");
                try {
                    const [serverCounts, serversForUser] = await Promise.all([
                        getServerUsageCounts(),
                        getAvailableServersForUser(currentUser),
                    ]);

                    if (serversForUser.length === 0) throw new Error("No available servers found for this user account.");

                    const leastBusyServer = serversForUser.reduce((leastBusy, currentServer) => {
                        const leastBusyUsage = serverCounts[leastBusy] || 0;
                        const currentUsage = serverCounts[currentServer] || 0;
                        return currentUsage < leastBusyUsage ? currentServer : leastBusy;
                    }, serversForUser[0]);

                    sessionStorage.setItem('selectedProxyServer', leastBusyServer);
                    await updateUserProxyServer(currentUser.id, leastBusyServer);

                    const serverName = leastBusyServer.replace('https://', '').replace('.monoklix.com', '');
                    console.log(`[Auto-Select Server] Silently connected to server ${serverName.toUpperCase()} with ${serverCounts[leastBusyServer] || 0} users.`);
                } catch (error) {
                    console.warn('[Auto-Select Server] Failed to find least busy server, connecting to a random fallback.', error);
                    let fallbackServers = ['https://s1.monoklix.com', 'https://s2.monoklix.com', 'https://s3.monoklix.com', 'https://s4.monoklix.com', 'https://s5.monoklix.com'];
                    if (currentUser.batch_02 === 'batch_02') {
                        fallbackServers = ['https://s6.monoklix.com', 'https://s7.monoklix.com', 'https://s8.monoklix.com', 'https://s9.monoklix.com'];
                    }
                    const fallback = fallbackServers[Math.floor(Math.random() * fallbackServers.length)];
                    
                    sessionStorage.setItem('selectedProxyServer', fallback);
                    await updateUserProxyServer(currentUser.id, fallback);
                    const serverName = fallback.replace('https://', '').replace('.monoklix.com', '');
                    console.log(`[Auto-Select Server] Silently connected to fallback server ${serverName.toUpperCase()}.`);
                }
            }
        };
        autoSelectServerIfNeeded();
    }, [currentUser]);
  
    const handleServerSelected = async (serverUrl: string) => {
        if (!currentUser) return;
        console.log(`[Session] User selected server: ${serverUrl}`);
        sessionStorage.setItem('selectedProxyServer', serverUrl);

        if (serverModalPurpose === 'change') {
            const updatedUser = { ...currentUser, proxyServer: serverUrl };
            handleUserUpdate(updatedUser);
            await updateUserProxyServer(currentUser.id, serverUrl);

            alert('Server changed successfully! The application will now reload.');
            window.location.reload();
        } else {
            await updateUserProxyServer(currentUser.id, serverUrl);
            setShowServerModal(false);
            proceedWithPostLoginFlow(currentUser);
        }
    };

    const handleOpenChangeServerModal = async () => {
        if (!currentUser) return;
        setServerModalPurpose('change');
        try {
            const [serverCounts, serversToShow] = await Promise.all([
                getServerUsageCounts(),
                getAvailableServersForUser(currentUser),
            ]);
            setServerOptions({ servers: serversToShow, usage: serverCounts });
            setShowServerModal(true);
        } catch (error) {
            console.error('[Server Selection] Error opening server modal:', error);
            alert('Could not fetch server list. Please try again.');
        }
    };

  const handleLoginSuccess = async (user: User) => {
    handleUserUpdate(user);
    logActivity('login');
    sessionStorage.setItem('session_started_at', new Date().toISOString());
    setServerModalPurpose('login');
    
    if (user.role === 'admin') {
        console.log("[Session] Admin user detected. Assigning to dedicated admin server.");
        const adminServer = 'https://s10.monoklix.com';
        sessionStorage.setItem('selectedProxyServer', adminServer);
        await updateUserProxyServer(user.id, adminServer);
        proceedWithPostLoginFlow(user);
    } else if (window.location.hostname === 'localhost') {
        console.log("[Session] Local Development: Skipping server selection.");
        proceedWithPostLoginFlow(user);
    } else {
        console.log("[Session] Waiting for user to select server...");
        try {
            const [serverCounts, serversToShow] = await Promise.all([
                getServerUsageCounts(),
                getAvailableServersForUser(user),
            ]);
            setServerOptions({ servers: serversToShow, usage: serverCounts });
            setShowServerModal(true);
        } catch (error) {
            console.error('[Session] Error during server selection setup. Using a random fallback server.', error);
            let fallbackServers = ['https://s1.monoklix.com', 'https://s2.monoklix.com', 'https://s3.monoklix.com', 'https://s4.monoklix.com', 'https://s5.monoklix.com'];
            if (user.batch_02 === 'batch_02') {
                fallbackServers = ['https://s6.monoklix.com', 'https://s7.monoklix.com', 'https://s8.monoklix.com', 'https://s9.monoklix.com'];
            }
            const fallbackServer = fallbackServers[Math.floor(Math.random() * fallbackServers.length)];

            sessionStorage.setItem('selectedProxyServer', fallbackServer);
            await updateUserProxyServer(user.id, fallbackServer);
            proceedWithPostLoginFlow(user);
        }
    }
  };
  
  if (!sessionChecked || (currentUser && isApiKeyLoading)) {
      return (
          <div className="flex items-center justify-center min-h-screen bg-neutral-100 dark:bg-neutral-900">
              <Spinner />
          </div>
      );
  }

  if (isShowingWelcome) {
    return <WelcomeAnimation onAnimationEnd={() => setIsShowingWelcome(false)} />;
  }
  
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  if (showServerModal) {
    return <ServerSelectionModal
        isOpen={true}
        servers={serverOptions.servers}
        serverUsage={serverOptions.usage}
        onSelect={handleServerSelected}
    />;
  }

  return (
    <div className="h-screen bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 font-sans flex">
      {showAssignModal && <AssigningTokenModal status={assigningStatus} error={autoAssignError} onRetry={retryAssignment} scanProgress={scanProgress} />}
      
      <main className="flex-1 flex flex-col overflow-y-auto min-w-0">
        <header className="flex items-center justify-between p-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-10">
          <div className="flex items-center gap-2">
             <LogoIcon className="w-28 text-neutral-800 dark:text-neutral-200" />
          </div>
          <div className="flex items-center gap-2 pr-2">
              <ThemeSwitcher theme={theme} setTheme={setTheme} />
               <button
                  onClick={() => setIsLogSidebarOpen(true)}
                  className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  aria-label={T.openConsole}
                  title={T.openConsole}
              >
                  <TerminalIcon className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
              </button>
              <button
                  onClick={handleClearCacheAndRefresh}
                  className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  aria-label={T.refreshSession}
                  title={T.refreshSessionTooltip}
              >
                  <RefreshCwIcon className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
              </button>
              <ApiKeyStatus 
                activeApiKey={activeApiKey} 
                veoTokenRefreshedAt={veoTokenRefreshedAt} 
                currentUser={currentUser}
                assignTokenProcess={assignTokenProcess}
                onUserUpdate={handleUserUpdate}
                onOpenChangeServerModal={handleOpenChangeServerModal}
              />
          </div>
        </header>
        {notification && <NotificationBanner message={notification} onDismiss={() => setNotification(null)} />}
        <div className="flex-1 p-4 md:p-8">
            <UgcGeneratorView currentUser={currentUser!} language={language} onUserUpdate={handleUserUpdate} />
        </div>
      </main>
      <ConsoleLogSidebar 
        isOpen={isLogSidebarOpen}
        onClose={() => setIsLogSidebarOpen(false)}
      />
    </div>
  );
};

export default App;