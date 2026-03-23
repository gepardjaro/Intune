import { GoogleGenAI, Type } from "@google/genai";

export interface AzureSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface PackageDetails {
  name: string;
  vendor: string;
  version: string;
  author: string;
  description: string;
  packageId: string;
  moniker: string;
}

export interface PSADTSettings {
  installMode: 'Interactive' | 'Silent' | 'NonInteractive' | 'Auto';
  uninstallMode: 'Interactive' | 'Silent' | 'NonInteractive' | 'Auto';
  scriptContent: string;
}

export interface IntuneSettings {
  publisher: string;
  developer: string;
  owner: string;
  notes: string;
  informationUrl: string;
  privacyUrl: string;
  iconUrl: string;
  installCommand: string;
  uninstallCommand: string;
  uninstallDeployMode: 'Interactive' | 'Silent' | 'NonInteractive';
  category: string;
  installBehavior: 'System' | 'User';
  rebootBehavior: 'DetermineByReturnCode' | 'ForceReboot' | 'SuppressReboot' | 'AppInstallMayForceReboot';
  minOS: string;
  maxInstallationTime: number;
  allowAvailableUninstall: boolean;
}

export interface AppState {
  azure: AzureSettings;
  package: PackageDetails;
  psadt: PSADTSettings;
  intune: IntuneSettings;
  step: number;
}

export const INITIAL_STATE: AppState = {
  azure: { tenantId: '', clientId: '', clientSecret: '' },
  package: { name: '', vendor: '', version: '', author: '', description: 'FILL THE DESCRIPTION', packageId: '', moniker: '' },
  psadt: { 
    installMode: 'Silent', 
    uninstallMode: 'Silent',
    scriptContent: ''
  },
  intune: { 
    publisher: '', 
    developer: '',
    owner: '',
    notes: '',
    informationUrl: '',
    privacyUrl: '',
    iconUrl: '', 
    installCommand: '', 
    uninstallCommand: '',
    uninstallDeployMode: 'Silent',
    category: '',
    installBehavior: 'System',
    rebootBehavior: 'DetermineByReturnCode',
    minOS: 'Windows 10 20H2',
    maxInstallationTime: 60,
    allowAvailableUninstall: false
  },
  step: 0
};
