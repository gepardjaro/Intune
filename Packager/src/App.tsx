import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Search, 
  Package, 
  FileCode, 
  CloudUpload, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft,
  Terminal,
  ShieldCheck,
  Download,
  RotateCcw,
  Sparkles,
  Info,
  RefreshCw,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { INITIAL_STATE, type AppState, type PackageDetails } from './types';
import { searchWingetApp, modifyPsadtScript } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [baseTemplate, setBaseTemplate] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'Name' | 'Id' | 'Moniker' | 'AI'>('Name');
  const [aiRequest, setAiRequest] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [serverPlatform, setServerPlatform] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    const initApp = async () => {
      try {
        // Fetch server info
        const infoRes = await fetch('/api/info');
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          setServerPlatform(infoData.platform);
          setHasApiKey(infoData.hasApiKey);
          if (!infoData.hasApiKey && searchType === 'AI') {
            setSearchType('Name');
          }
        }

        // Trigger automatic setup on backend
        await fetch('/api/psadt/setup', { method: 'POST' });
        
        // Fetch template
        const response = await fetch('/api/psadt/template');
        if (response.ok) {
          const data = await response.json();
          setBaseTemplate(data.content);
          setState(prev => ({
            ...prev,
            psadt: { ...prev.psadt, scriptContent: data.content }
          }));
        }
      } catch (error) {
        console.error("Initialization error:", error);
      }
    };
    initApp();
  }, []);

  useEffect(() => {
    if (baseTemplate) {
      let content = baseTemplate;
      
      // PSADT 4.1.8 Template Replacements
      content = content.replace(/AppVendor = ''/g, `AppVendor = '${state.package.vendor || ''}'`);
      content = content.replace(/AppName = ''/g, `AppName = '${state.package.name || ''}'`);
      content = content.replace(/AppVersion = ''/g, `AppVersion = '${state.package.version || ''}'`);
      
      // Legacy/Custom Replacements
      content = content.replace(/\[\[AppName\]\]/g, state.package.name || 'Unknown App');
      content = content.replace(/\[\[Vendor\]\]/g, state.package.vendor || 'Unknown Vendor');
      content = content.replace(/\[\[Version\]\]/g, state.package.version || '0.0.0');
      content = content.replace(/\[\[PackageId\]\]/g, state.package.packageId || 'unknown.package');
      
      if (content !== state.psadt.scriptContent) {
        setState(prev => ({ ...prev, psadt: { ...prev.psadt, scriptContent: content } }));
      }

      // Sync Intune commands
      const installCmd = `powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Install" -DeployMode "${state.psadt.installMode}"`;
      const uninstallCmd = `powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Uninstall" -DeployMode "${state.intune.uninstallDeployMode}"`;
      
      if (installCmd !== state.intune.installCommand || uninstallCmd !== state.intune.uninstallCommand) {
        setState(prev => ({ 
          ...prev, 
          intune: { 
            ...prev.intune, 
            installCommand: installCmd,
            uninstallCommand: uninstallCmd
          } 
        }));
      }
    }
  }, [state.package.name, state.package.version, state.package.vendor, state.package.packageId, baseTemplate, state.psadt.installMode, state.intune.uninstallDeployMode]);

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [localIcons, setLocalIcons] = useState<string[]>([]);
  const [iconSearch, setIconSearch] = useState('');
  const [isImportingToIntune, setIsImportingToIntune] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  const saveTemplate = async () => {
    setIsSavingTemplate(true);
    setError(null);
    try {
      const response = await fetch('/api/psadt/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: state.psadt.scriptContent })
      });
      if (response.ok) {
        alert("Template saved successfully!");
      } else {
        throw new Error("Failed to save template");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleRefreshIcon = async () => {
    const cleanName = state.package.name.toLowerCase().replace(/ /g, '');
    const moniker = state.package.moniker.toLowerCase();
    
    // 1. Fetch list of local icons
    try {
      const listResponse = await fetch('/api/icons/list');
      if (listResponse.ok) {
        const icons: string[] = await listResponse.json();
        
        // Try to find a fuzzy match (case-insensitive, contains app name or moniker)
        const match = icons.find(icon => {
          const iconLower = icon.toLowerCase().replace('.png', '').replace('.ico', '');
          return iconLower === cleanName || 
                 iconLower === moniker ||
                 cleanName.includes(iconLower) ||
                 moniker.includes(iconLower) ||
                 iconLower.includes(cleanName) || 
                 iconLower.includes(moniker);
        });

        if (match) {
          console.log("Found fuzzy match in local icons:", match);
          const iconUrl = `/icons/${match}`;
          setState(s => ({ ...s, intune: { ...s.intune, iconUrl } }));
          
          // Sync to PSADT folder
          await fetch('/api/icon/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `http://localhost:3000${iconUrl}`, appName: state.package.name })
          });
          return;
        }
      }
    } catch (err) {
      console.warn("Local icon listing failed:", err);
    }

    // 2. Try to find icon via favicon service if moniker or name is available
    if (moniker || state.package.name) {
      const query = moniker || state.package.name;
      // Using a more reliable favicon service
      const iconUrl = `https://www.google.com/s2/favicons?domain=${query}.com&sz=128`;
      setState(s => ({ ...s, intune: { ...s.intune, iconUrl } }));
      
      // Sync to PSADT folder
      await fetch('/api/icon/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: iconUrl, appName: state.package.name })
      });
      return;
    }

    // 3. Fallback to a default if no match found locally
    const defaultIcon = `https://img.icons8.com/color/96/000000/package.png`;
    setState(s => ({ ...s, intune: { ...s.intune, iconUrl: defaultIcon } }));
    
    try {
      await fetch('/api/icon/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: defaultIcon, appName: state.package.name })
      });
    } catch (err) {
      console.warn("Default icon sync failed:", err);
    }
  };

  const handleSetupIcons = async () => {
    try {
      const response = await fetch('/api/icons/setup', { method: 'POST' });
      if (response.ok) {
        console.log("Icons repository setup triggered successfully.");
        handleRefreshIcon();
      }
    } catch (err) {
      console.error("Failed to trigger icons setup:", err);
    }
  };

  const openIconPicker = async () => {
    try {
      const response = await fetch('/api/icons/list');
      if (response.ok) {
        const icons = await response.json();
        setLocalIcons(icons);
        setIsIconPickerOpen(true);
      }
    } catch (err) {
      console.error("Failed to list local icons:", err);
    }
  };

  const selectLocalIcon = async (iconName: string) => {
    const iconUrl = `/icons/${iconName}`;
    setState(s => ({ ...s, intune: { ...s.intune, iconUrl } }));
    setIsIconPickerOpen(false);
    
    // Also trigger the download to the PSADT folder
    try {
      await fetch('/api/icon/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `http://localhost:3000${iconUrl}`, appName: state.package.name })
      });
    } catch (err) {
      console.warn("Failed to sync selected icon to PSADT folder:", err);
    }
  };

  const handleFullImport = async () => {
    setIsImportingToIntune(true);
    setImportResult(null);
    try {
      const response = await fetch('/api/intune/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: state.package.name,
          appId: state.package.packageId,
          version: state.package.version,
          publisher: state.intune.publisher,
          category: state.intune.category,
          description: state.package.description,
          iconUrl: state.intune.iconUrl,
          installCommand: state.intune.installCommand,
          uninstallCommand: state.intune.uninstallCommand,
          azure: state.azure,
          developer: state.intune.developer,
          owner: state.intune.owner,
          notes: state.intune.notes,
          informationUrl: state.intune.informationUrl,
          privacyUrl: state.intune.privacyUrl,
          minOS: state.intune.minOS,
          maxInstallationTime: state.intune.maxInstallationTime,
          allowAvailableUninstall: state.intune.allowAvailableUninstall,
          installBehavior: state.intune.installBehavior,
          deviceRestartBehavior: state.intune.rebootBehavior,
          showWelcome: state.psadt.showWelcome,
          showProgress: state.psadt.showProgress
        })
      });
      const result = await response.json();
      if (result.success) {
        setImportResult({ success: true, message: result.message });
      } else {
        throw new Error(result.error || "Import failed");
      }
    } catch (err: any) {
      setImportResult({ success: false, message: "Failed to import to Intune: " + err.message });
    } finally {
      setIsImportingToIntune(false);
    }
  };

  const nextStep = () => {
    setError(null);
    setState(prev => ({ ...prev, step: prev.step + 1 }));
  };
  const prevStep = () => {
    setError(null);
    setState(prev => ({ ...prev, step: prev.step - 1 }));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setError(null);
    try {
      const results = await searchWingetApp(searchQuery, searchType);
      setSearchResults(results);
    } catch (err: any) {
      setError(err.message);
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectApp = (app: any) => {
    const vendor = app.publisher || app.name.split(' ')[0];
    setState(prev => ({
      ...prev,
      package: {
        ...prev.package,
        name: app.name,
        packageId: app.id,
        version: app.version,
        moniker: app.moniker,
        vendor: vendor,
        description: prev.package.description || 'FILL THE DESCRIPTION'
      },
      intune: {
        ...prev.intune,
        publisher: vendor,
        developer: vendor
      }
    }));

    // Re-fetch template with actual app details so placeholders are replaced
    const params = new URLSearchParams({
      appId: app.id,
      appName: app.name,
      publisher: vendor,
      version: app.version,
    });
    fetch(`/api/psadt/template?${params}`)
      .then(res => res.json())
      .then(data => {
        setBaseTemplate(data.content);
        setState(prev => ({
          ...prev,
          psadt: { ...prev.psadt, scriptContent: data.content }
        }));
      })
      .catch(err => console.error("Failed to refresh template:", err));

    nextStep();
  };

  const handleAiModify = async () => {
    setIsModifying(true);
    setError(null);
    setHistory(prev => [...prev, state.psadt.scriptContent]);
    try {
      const modified = await modifyPsadtScript(state.psadt.scriptContent, aiRequest);
      setState(prev => ({
        ...prev,
        psadt: { ...prev.psadt, scriptContent: modified }
      }));
      setAiRequest('');
    } catch (err: any) {
      setError(err.message);
      console.error(err);
    } finally {
      setIsModifying(false);
    }
  };

  const revertScript = () => {
    if (history.length > 0) {
      const last = history[history.length - 1];
      setState(prev => ({
        ...prev,
        psadt: { ...prev.psadt, scriptContent: last }
      }));
      setHistory(prev => prev.slice(0, -1));
    }
  };

  const [isWrapping, setIsWrapping] = useState(false);
  const [wrapResult, setWrapResult] = useState<any>(null);

  const handleWrap = async () => {
    setIsWrapping(true);
    setError(null);
    try {
      const response = await fetch('/api/wrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: state.package.name,
          version: state.package.version
        })
      });
      const result = await response.json();
      if (result.success) {
        setWrapResult(result);
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsWrapping(false);
    }
  };

  const steps = [
    { title: 'Azure Setup', icon: ShieldCheck },
    { title: 'Search App', icon: Search },
    { title: 'PSADT Config', icon: FileCode },
    { title: 'Intune Details', icon: Package },
    { title: 'Summary', icon: CheckCircle2 }
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Terminal size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">Intune App Packager Pro</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Enterprise Deployment Tool</p>
          </div>
        </div>
        
        <nav className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          {steps.map((s, i) => (
            <div 
              key={i}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-300",
                state.step === i ? "bg-white text-indigo-600 shadow-sm" : "text-gray-400"
              )}
            >
              <s.icon size={16} />
              <span className="text-sm font-semibold hidden md:block">{s.title}</span>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors">
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium flex items-center gap-3"
            >
              <Info size={18} />
              {error}
            </motion.div>
          )}
          {state.step === 0 && (
            <motion.div 
              key="step0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold mb-2">Azure & AI Configuration</h2>
                <p className="text-gray-500">Provide your Azure application details to enable Intune integration and AI assistance.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <ShieldCheck className="text-indigo-600" size={20} />
                    Azure Credentials
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tenant ID</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={state.azure.tenantId}
                        onChange={e => setState(s => ({ ...s, azure: { ...s.azure, tenantId: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Client ID</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={state.azure.clientId}
                        onChange={e => setState(s => ({ ...s, azure: { ...s.azure, clientId: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Client Secret</label>
                      <input 
                        type="password" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="••••••••••••••••"
                        value={state.azure.clientSecret}
                        onChange={e => setState(s => ({ ...s, azure: { ...s.azure, clientSecret: e.target.value } }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-600 p-8 rounded-3xl text-white shadow-xl shadow-indigo-200 flex flex-col justify-between">
                  <div>
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                      <Sparkles size={24} />
                    </div>
                    <h3 className="text-2xl font-bold mb-4">AI-Powered Packaging</h3>
                    <p className="text-indigo-100 leading-relaxed">
                      Leverage Gemini to automate script modifications, find the best package versions, and generate Intune metadata instantly.
                    </p>
                  </div>
                  <div className="mt-8 p-4 bg-white/10 rounded-2xl border border-white/20">
                    <p className="text-xs font-medium flex items-center gap-2">
                      <Info size={14} />
                      Data is processed securely via your provided API key.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button 
                  onClick={nextStep}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  Continue to Search
                  <ChevronRight size={20} />
                </button>
              </div>
            </motion.div>
          )}

          {state.step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold mb-2">Find Application</h2>
                <p className="text-gray-500">Search for the application using PowerShell (pwsh) or use AI to find the best match.</p>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-700 text-xs font-medium">
                  <Info size={14} />
                  <span>
                    {serverPlatform === 'win32' 
                      ? "Note: You are running locally on Windows. WinGet search and PSADT packaging are using your local PowerShell environment."
                      : "Note: This Preview Environment is Linux-based. Real WinGet search and PSADT packaging will work fully when you Export and run this app on your Windows machine."
                    }
                  </span>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="flex-1 min-w-[300px] relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                      type="text" 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-lg"
                      placeholder={searchType === 'AI' ? "Describe the app you need..." : "Search by name, ID or moniker..."}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    />
                  </div>
                    <select 
                      className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-indigo-500 outline-none font-semibold"
                      value={searchType}
                      onChange={e => setSearchType(e.target.value as any)}
                    >
                      <option value="Name">Name</option>
                      <option value="Id">ID</option>
                      <option value="Moniker">Moniker</option>
                      {hasApiKey && <option value="AI">AI Search ✨</option>}
                    </select>
                  <button 
                    onClick={handleSearch}
                    disabled={isSearching}
                    className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50"
                  >
                    {isSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-gray-100">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase">Name</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase">ID</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase">Version</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase">Moniker</th>
                          <th className="px-6 py-4 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {searchResults.map((app, i) => (
                          <tr 
                            key={i} 
                            onClick={() => selectApp(app)}
                            className="hover:bg-indigo-50/30 transition-colors group cursor-pointer"
                          >
                            <td className="px-6 py-4 font-bold">
                              <div className="flex items-center gap-2">
                                {app.name}
                                {app.source === 'mock' && (
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full uppercase tracking-tighter">Mock Data</span>
                                )}
                                {app.source === 'ai' && (
                                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full uppercase tracking-tighter">AI Generated</span>
                                )}
                                {app.source === 'winget' && (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-tighter">WinGet</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 font-mono text-sm text-gray-500">{app.id}</td>
                            <td className="px-6 py-4 text-sm font-medium text-indigo-600">{app.version}</td>
                            <td className="px-6 py-4 text-sm text-gray-400">{app.moniker}</td>
                            <td className="px-6 py-4 text-right min-w-[140px]">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectApp(app);
                                }}
                                className="flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap w-full"
                              >
                                <span>Select</span>
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <button 
                  onClick={prevStep}
                  className="px-8 py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Back
                </button>
              </div>
            </motion.div>
          )}

          {state.step === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-3xl font-bold mb-2">PSADT Configuration</h2>
                  <p className="text-gray-500">Customize your PowerShell App Deployment Toolkit script.</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">DeployMode:</span>
                  <div className="bg-white p-1 rounded-xl border border-gray-200 flex">
                    {(['Interactive', 'Silent', 'NonInteractive', 'Auto'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setState(s => ({ ...s, psadt: { ...s.psadt, installMode: mode } }))}
                        className={cn(
                          "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                          state.psadt.installMode === mode ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        {mode === 'Auto' ? 'Auto (AI detection)' : mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-[#1E1E1E] rounded-3xl overflow-hidden shadow-2xl border border-white/5">
                    <div className="bg-[#2D2D2D] px-6 py-3 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
                        </div>
                        <span className="text-xs font-mono text-gray-400 ml-4">Invoke-AppDeployToolkit.ps1</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={saveTemplate}
                          disabled={isSavingTemplate}
                          className="p-1.5 text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                          title="Save current script as the default template"
                        >
                          <CloudUpload size={14} />
                          {isSavingTemplate ? 'Saving...' : 'Save Template'}
                        </button>
                        {history.length > 0 && (
                          <button 
                            onClick={revertScript}
                            className="p-1.5 text-gray-400 hover:text-white transition-colors"
                            title="Revert AI changes"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <button className="p-1.5 text-gray-400 hover:text-white transition-colors">
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                    <textarea 
                      className="w-full h-[500px] bg-transparent text-[#D4D4D4] font-mono text-sm p-8 outline-none resize-none leading-relaxed"
                      value={state.psadt.scriptContent}
                      onChange={e => setState(s => ({ ...s, psadt: { ...s.psadt, scriptContent: e.target.value } }))}
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <Sparkles className="text-indigo-600" size={18} />
                      AI Script Assistant
                    </h3>
                    <p className="text-sm text-gray-500">Ask Gemini to add logic, fix errors, or customize the deployment flow.</p>
                    <textarea 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500 min-h-[120px]"
                      placeholder="Example: Add a check to close Outlook before installation..."
                      value={aiRequest}
                      onChange={e => setAiRequest(e.target.value)}
                    />
                    <button 
                      onClick={handleAiModify}
                      disabled={!aiRequest || isModifying}
                      className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isModifying ? 'Modifying...' : 'Apply AI Changes'}
                    </button>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-widest text-gray-600">PSADT Options</h3>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-sm text-gray-700">Show-ADTInstallationWelcome</span>
                      <button
                        onClick={() => setState(s => ({ ...s, psadt: { ...s.psadt, showWelcome: !s.psadt.showWelcome } }))}
                        className={cn(
                          "w-10 h-6 rounded-full transition-colors relative",
                          state.psadt.showWelcome ? "bg-indigo-600" : "bg-gray-300"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                          state.psadt.showWelcome ? "left-[18px]" : "left-0.5"
                        )} />
                      </button>
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-sm text-gray-700">Show-ADTInstallationProgress</span>
                      <button
                        onClick={() => setState(s => ({ ...s, psadt: { ...s.psadt, showProgress: !s.psadt.showProgress } }))}
                        className={cn(
                          "w-10 h-6 rounded-full transition-colors relative",
                          state.psadt.showProgress ? "bg-indigo-600" : "bg-gray-300"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                          state.psadt.showProgress ? "left-[18px]" : "left-0.5"
                        )} />
                      </button>
                    </label>
                  </div>

                  <div className="bg-gray-900 p-6 rounded-3xl text-white space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-widest text-indigo-400">Package Info</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">App Name</label>
                        <input 
                          type="text" 
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                          value={state.package.name}
                          onChange={e => setState(s => ({ ...s, package: { ...s.package, name: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Version</label>
                        <input 
                          type="text" 
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                          value={state.package.version}
                          onChange={e => setState(s => ({ ...s, package: { ...s.package, version: e.target.value } }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button 
                  onClick={prevStep}
                  className="px-8 py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Back
                </button>
                <button 
                  onClick={nextStep}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  Intune Details
                  <ChevronRight size={20} />
                </button>
              </div>
            </motion.div>
          )}

          {state.step === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h2 className="text-3xl font-bold mb-2">Intune Application Details</h2>
                <p className="text-gray-500">Finalize the metadata that will appear in the Intune Company Portal.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Publisher</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.publisher}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, publisher: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Developer</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.developer}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, developer: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Owner</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.owner}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, owner: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Information URL</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.informationUrl}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, informationUrl: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Privacy URL</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.privacyUrl}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, privacyUrl: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Notes</label>
                      <textarea 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px]"
                        value={state.intune.notes}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, notes: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Category</label>
                      <input 
                        type="text" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="e.g. Productivity, Utilities..."
                        value={state.intune.category}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, category: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Behavior</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.installBehavior}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, installBehavior: e.target.value as any } }))}
                      >
                        <option value="System">System</option>
                        <option value="User">User</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Reboot Behavior</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.rebootBehavior}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, rebootBehavior: e.target.value as any } }))}
                      >
                        <option value="DetermineByReturnCode">Determine By Return Code</option>
                        <option value="ForceReboot">Force Reboot</option>
                        <option value="SuppressReboot">Suppress Reboot</option>
                        <option value="AppInstallMayForceReboot">App Install May Force Reboot</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Uninstall Mode</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.uninstallDeployMode}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, uninstallDeployMode: e.target.value as any } }))}
                      >
                        <option value="Silent">Silent</option>
                        <option value="Interactive">Interactive</option>
                        <option value="NonInteractive">NonInteractive</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Minimum OS</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.minOS}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, minOS: e.target.value } }))}
                      >
                        <option>Windows 10 1607</option>
                        <option>Windows 10 1703</option>
                        <option>Windows 10 1709</option>
                        <option>Windows 10 1803</option>
                        <option>Windows 10 1809</option>
                        <option>Windows 10 1903</option>
                        <option>Windows 10 1909</option>
                        <option>Windows 10 2004</option>
                        <option>Windows 10 20H2</option>
                        <option>Windows 10 21H1</option>
                        <option>Windows 10 21H2</option>
                        <option>Windows 10 22H2</option>
                        <option>Windows 11 21H2</option>
                        <option>Windows 11 22H2</option>
                        <option>Windows 11 23H2</option>
                        <option>Windows 11 24H2</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Max Time (Min)</label>
                      <input 
                        type="number" 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={state.intune.maxInstallationTime}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, maxInstallationTime: parseInt(e.target.value) } }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Description</label>
                      <textarea 
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px]"
                        value={state.package.description}
                        onChange={e => setState(s => ({ ...s, package: { ...s.package, description: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2 flex items-center gap-3 mt-2">
                      <input 
                        type="checkbox" 
                        id="allowUninstall"
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        checked={state.intune.allowAvailableUninstall}
                        onChange={e => setState(s => ({ ...s, intune: { ...s.intune, allowAvailableUninstall: e.target.checked } }))}
                      />
                      <label htmlFor="allowUninstall" className="text-sm font-bold text-gray-700">
                        Allow available uninstall
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-bold text-sm text-gray-400 uppercase tracking-widest">Commands</h4>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Install Command</label>
                      <div className="bg-gray-900 text-indigo-400 p-3 rounded-xl font-mono text-xs">
                        powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Install" -DeployMode "{state.psadt.installMode}"
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Uninstall Command</label>
                      <div className="bg-gray-900 text-indigo-400 p-3 rounded-xl font-mono text-xs">
                        powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Uninstall" -DeployMode "{state.psadt.uninstallMode}"
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="font-bold text-lg">App Icon</h3>
                    <div className="flex items-center gap-6">
                      <div className="w-24 h-24 bg-gray-100 rounded-2xl flex items-center justify-center border-2 border-dashed border-gray-200 overflow-hidden group relative">
                        {state.intune.iconUrl ? (
                          <img src={state.intune.iconUrl} alt="App Icon" className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                        ) : (
                          <Package className="text-gray-300" size={32} />
                        )}
                        <button 
                          onClick={handleRefreshIcon}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-white"
                        >
                          <RefreshCw size={24} />
                        </button>
                      </div>
                      <div className="flex-1 space-y-3">
                        <p className="text-sm text-gray-500 leading-relaxed">Icons are automatically sourced from the community repository and downloaded to your source folder.</p>
                        <div className="flex flex-wrap gap-3">
                          <button 
                            onClick={handleRefreshIcon}
                            className="text-indigo-600 font-bold text-sm hover:underline flex items-center gap-1"
                          >
                            <RotateCcw size={14} />
                            Refresh & Download
                          </button>
                          <button 
                            onClick={openIconPicker}
                            className="text-gray-500 font-bold text-sm hover:underline flex items-center gap-1 border-l pl-3 border-gray-200"
                            title="Choose an icon from the local icons repository"
                          >
                            <Search size={14} />
                            Choose icon manually
                          </button>
                        </div>
                      </div>
                    </div>
                    <input 
                      type="text" 
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Icon URL..."
                      value={state.intune.iconUrl}
                      onChange={e => setState(s => ({ ...s, intune: { ...s.intune, iconUrl: e.target.value } }))}
                    />
                  </div>

                  <div className="bg-amber-50 border border-amber-100 p-6 rounded-3xl space-y-2">
                    <h4 className="font-bold text-amber-800 flex items-center gap-2">
                      <Info size={16} />
                      Packaging Tip
                    </h4>
                    <p className="text-sm text-amber-700 leading-relaxed">
                      Ensure all source files are placed in the <code className="bg-amber-100 px-1 rounded">Files</code> folder of your PSADT structure before wrapping.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button 
                  onClick={prevStep}
                  className="px-8 py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Back
                </button>
                <button 
                  onClick={nextStep}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  Review & Build
                  <ChevronRight size={20} />
                </button>
              </div>
            </motion.div>
          )}

          {state.step === 4 && (
            <motion.div 
              key="step4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8 text-center max-w-3xl mx-auto"
            >
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 size={40} />
              </div>
              
              <h2 className="text-4xl font-bold">Ready to Package</h2>
              <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm max-w-md mx-auto flex items-center gap-4 text-left">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Package size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{state.package.name}</h3>
                  <p className="text-gray-500 text-sm">Version {state.package.version}</p>
                </div>
              </div>
              <p className="text-gray-500 text-lg">Your application configuration is complete. Choose your deployment method below.</p>

              <div className="grid md:grid-cols-2 gap-6 mt-12 text-left">

                <button 
                  onClick={handleWrap}
                  disabled={isWrapping}
                  className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:border-indigo-600 transition-all group relative overflow-hidden"
                >
                  {isWrapping && (
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute bottom-0 left-0 h-1 bg-indigo-600"
                    />
                  )}
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                    <Package size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Wrap to .intunewin</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Runs IntuneWinAppUtil via pwsh to package your PSADT folder into a production-ready file.
                  </p>
                  {wrapResult && (
                    <div className="mt-4 p-4 bg-green-50 border border-green-100 text-green-700 rounded-2xl text-xs font-medium space-y-2">
                      <div className="flex items-center gap-2 font-bold">
                        <CheckCircle2 size={14} />
                        {wrapResult.message}
                      </div>
                      <div className="bg-white/50 p-2 rounded-lg font-mono break-all">
                        File: {wrapResult.fileName}
                      </div>
                      <p className="opacity-80">Check the <code>/output</code> folder on your local machine.</p>
                    </div>
                  )}
                  {error && state.step === 4 && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-xs font-medium flex items-start gap-2">
                      <Info size={14} className="shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold mb-1">Packaging Error</p>
                        <p className="opacity-80">{error}</p>
                      </div>
                    </div>
                  )}
                </button>

                <button 
                  onClick={handleFullImport}
                  disabled={isImportingToIntune}
                  className="bg-indigo-600 p-8 rounded-3xl text-white shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all group relative overflow-hidden"
                >
                  {isImportingToIntune && (
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 3 }}
                      className="absolute bottom-0 left-0 h-1 bg-white/30"
                    />
                  )}
                  <div className="w-12 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <CloudUpload size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                    {isImportingToIntune ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        Importing to Intune...
                      </>
                    ) : (
                      "Full Import to Intune"
                    )}
                  </h3>
                  <p className="text-sm text-indigo-100 leading-relaxed">
                    Automated end-to-end process: Wraps, uploads to Azure, and creates the Win32 app in Microsoft Intune.
                  </p>
                  {importResult && (
                    <div className={cn(
                      "mt-4 p-4 rounded-2xl text-xs font-medium flex items-start gap-2",
                      importResult.success ? "bg-white/20 text-white" : "bg-red-500/20 text-white"
                    )}>
                      {importResult.success ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                      <div className="flex-1 overflow-hidden">
                        <p className="whitespace-pre-wrap break-all">{importResult.message}</p>
                      </div>
                    </div>
                  )}
                </button>
              </div>

              <div className="mt-8 p-6 bg-blue-50 border border-blue-100 rounded-3xl text-left flex gap-4">
                <ShieldCheck className="text-blue-600 shrink-0" size={24} />
                <div>
                  <h4 className="font-bold text-blue-900 mb-1 text-sm">Privacy & Security Note</h4>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    This application processes your Azure credentials and scripts locally in your browser. AI interactions are handled via the Gemini API. For corporate users (e.g., MacGregor), ensure your Gemini API usage complies with internal data protection policies. AI Studio Build environment does not store your secrets on its own servers beyond the session.
                  </p>
                </div>
              </div>

              <div className="mt-8 p-8 bg-gray-50 rounded-3xl border border-gray-200 text-left space-y-6">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm uppercase tracking-widest text-gray-400">Package Summary</h4>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 bg-indigo-100 text-indigo-600 rounded-full text-[10px] font-bold uppercase">PSADT v4.x</span>
                    <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase">Ready</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                  <div>
                    <span className="text-xs text-gray-400 block">App Name</span>
                    <span className="font-bold">{state.package.name}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block">Version</span>
                    <span className="font-bold">{state.package.version}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block">Package ID</span>
                    <span className="font-bold font-mono text-sm">{state.package.packageId}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block">Install Mode</span>
                    <span className="font-bold text-indigo-600">{state.psadt.installMode}</span>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-200 space-y-4">
                  <h5 className="font-bold text-sm flex items-center gap-2">
                    <FileCode size={16} className="text-indigo-600" />
                    Local Directory Structure
                  </h5>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-white rounded-xl border border-gray-200">
                      <span className="text-[10px] font-bold text-gray-400 block mb-1">Source</span>
                      <span className="text-xs font-mono">/src_packager/PSADT</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-gray-200">
                      <span className="text-[10px] font-bold text-gray-400 block mb-1">Tool</span>
                      <span className="text-xs font-mono">/intunewinapputil</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-gray-200">
                      <span className="text-[10px] font-bold text-gray-400 block mb-1">Output</span>
                      <span className="text-xs font-mono">/output</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center gap-4">
                <button 
                  onClick={() => setState(s => ({ ...s, step: 0 }))}
                  className="px-8 py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Start New Package
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isIconPickerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsIconPickerOpen(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
              >
                <div className="p-8 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-2xl font-bold">Choose Icon Manually</h3>
                    <p className="text-sm text-gray-500">Browsing local icons repository</p>
                  </div>
                  <button 
                    onClick={() => setIsIconPickerOpen(false)}
                    className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors"
                  >
                    <ChevronRight className="rotate-90" size={24} />
                  </button>
                </div>

                <div className="p-8 bg-gray-50 border-b border-gray-100 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                      type="text"
                      placeholder="Search icons by name..."
                      value={iconSearch}
                      onChange={(e) => setIconSearch(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {localIcons
                      .filter(icon => icon.toLowerCase().includes(iconSearch.toLowerCase()))
                      .map(icon => (
                        <button
                          key={icon}
                          onClick={() => selectLocalIcon(icon)}
                          className="group flex flex-col items-center gap-3 p-4 rounded-3xl hover:bg-indigo-50 border border-transparent hover:border-indigo-100 transition-all"
                        >
                          <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center overflow-hidden group-hover:scale-110 transition-transform">
                            <img 
                              src={`/icons/${icon}`} 
                              alt={icon}
                              className="w-12 h-12 object-contain"
                              referrerPolicy="no-referrer"
                              onError={(e) => (e.currentTarget.src = 'https://picsum.photos/seed/app/64/64')}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-gray-500 text-center break-all line-clamp-2 group-hover:text-indigo-600">
                            {icon}
                          </span>
                        </button>
                      ))}
                  </div>
                  {localIcons.length === 0 && (
                    <div className="text-center py-20">
                      <Package className="mx-auto text-gray-300 mb-4" size={48} />
                      <p className="text-gray-500 font-medium">No icons found in the local repository.</p>
                      <button 
                        onClick={handleSetupIcons}
                        className="mt-4 text-indigo-600 font-bold hover:underline"
                      >
                        Download Repository Now
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-8 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4 text-gray-400 text-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} />
          <span>Enterprise Grade Security</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-indigo-600 transition-colors">Documentation</a>
          <a href="#" className="hover:text-indigo-600 transition-colors">Winget Repo</a>
          <a href="#" className="hover:text-indigo-600 transition-colors">PSADT Toolkit</a>
        </div>
        <p>© 2026 Intune App Packager Pro. All rights reserved.</p>
      </footer>
    </div>
  );
}
